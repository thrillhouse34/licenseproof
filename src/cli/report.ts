import * as fs from 'fs';
import * as path from 'path';
import { buildReportData, NoProjectFoundError, type ReportData } from '../report/reportData';
import { renderHtml } from '../report/html';
import { renderPdf } from '../report/pdf';
import { renderNotices } from '../report/notices';
import { renderCycloneDx } from '../report/sbom/cyclonedx';
import { renderSpdx } from '../report/sbom/spdx';
import { discoverLicenseKey } from '../license/discovery';
import { verifyLicenseKey, type LicenseInfo } from '../license/verify';
import { dataCurrencyNote } from '../license/dataCurrency';

export const REPORT_FORMATS = ['html', 'pdf', 'notices', 'sbom-cyclonedx', 'sbom-spdx'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * The formats that require a valid paid license key. `sbom-cyclonedx` is the one
 * free `report` format (the same machine-readable SBOM the free tier promises);
 * everything else is a paid, audit-ready artifact.
 */
const GATED_FORMATS: ReadonlySet<ReportFormat> = new Set<ReportFormat>([
  'html',
  'pdf',
  'notices',
  'sbom-spdx',
]);

/** New exit code (distinct from `report`'s existing 0/2): request refused for lack of a key. */
export const EXIT_UNLICENSED = 3;

/**
 * The friendly, non-naggy refusal shown when a gated format is requested without
 * a valid key. States what the paid report includes, the price, and where to buy.
 */
const UNLICENSED_MESSAGE = [
  'This report format needs a LicenseProof license.',
  '',
  'The paid report gives you audit-ready HTML and PDF reports, third-party',
  'notices, and SBOM output. It is a perpetual license: $29 individual, $99',
  'agency. See samples and buy a key at https://licenseproof.dev',
  '',
  'Already have a key? Run:  licenseproof activate <key>',
  'The free scan, JSON output, and sbom-cyclonedx never need a key.',
].join('\n');

/** Default per-format filenames used whenever `--out` names a directory (or is omitted). */
const DEFAULT_FILENAMES: Record<ReportFormat, string> = {
  html: 'report.html',
  pdf: 'report.pdf',
  notices: 'THIRD_PARTY_NOTICES.txt',
  'sbom-cyclonedx': 'sbom.cyclonedx.json',
  'sbom-spdx': 'sbom.spdx.json',
};

/** Default output directory when `--out` is omitted, matching the v1 spec's `--output <dir>` default. */
const DEFAULT_OUT_DIR = './licenseproof-report';

const VALID_LIST = REPORT_FORMATS.join(', ');

export interface RunReportOptions {
  path: string;
  productionOnly: boolean;
  /** Raw requested formats (comma-list already expanded by the CLI collector). Validated here. */
  formats: string[];
  /** `--out` value: a single file path (one format) or a directory (multiple/omitted). */
  out?: string;
  projectLicenseOverride?: string;
  /** The `--key <string>` value, if the user passed one on `report` (highest-priority key source). */
  key?: string;
  /** Environment to resolve `LICENSEPROOF_KEY` from. Defaults to `process.env`; injectable for hermetic tests. */
  env?: NodeJS.ProcessEnv;
  /** License-key-file path override. Defaults to `~/.config/licenseproof/license.key`; injectable for hermetic tests. */
  keyFilePath?: string;
}

export interface RunReportResult {
  exitCode: number;
  output: string;
}

/** Produce the artifact bytes for one format. String artifacts and the binary PDF are both handled. */
async function renderFormat(fmt: ReportFormat, data: ReportData): Promise<string | Buffer> {
  switch (fmt) {
    case 'html':
      return renderHtml(data);
    case 'pdf':
      // The PDF is the HTML report printed through a real browser — same single
      // renderer, so the two artifacts can never drift. `data` is passed too:
      // the PDF's per-page footer needs the provenance fields directly (see
      // src/report/pdf.ts).
      return renderPdf(renderHtml(data), data);
    case 'notices':
      return renderNotices(data);
    case 'sbom-cyclonedx':
      return renderCycloneDx(data);
    case 'sbom-spdx':
      return renderSpdx(data);
  }
}

/**
 * Validate + de-duplicate the requested formats. Returns the ordered unique
 * format list on success, or an error message string on failure (unknown value
 * or empty request) — never silently drops a typo'd format.
 */
function validateFormats(requested: string[]): { formats: ReportFormat[] } | { error: string } {
  if (requested.length === 0) {
    return { error: `licenseproof report: at least one --format is required (${VALID_LIST}).` };
  }
  const seen = new Set<string>();
  const formats: ReportFormat[] = [];
  for (const raw of requested) {
    const value = raw.trim();
    if (!(REPORT_FORMATS as readonly string[]).includes(value)) {
      return { error: `licenseproof report: unknown format "${raw}". Valid formats: ${VALID_LIST}.` };
    }
    if (!seen.has(value)) {
      seen.add(value);
      formats.push(value as ReportFormat);
    }
  }
  return { formats };
}

/**
 * `--out` reconciliation (documented in the CLI --help and README): honor `--out`
 * as a literal file path ONLY when exactly one format was requested; otherwise
 * (multiple formats, or `--out` omitted) treat it as an output DIRECTORY and
 * write each artifact under it with its default filename. When `--out` is omitted
 * entirely, default to ./licenseproof-report/ regardless of format count. Returns
 * the absolute target path for each requested format.
 */
function resolveOutputTargets(formats: ReportFormat[], out: string | undefined): { format: ReportFormat; target: string }[] {
  if (out !== undefined && formats.length === 1) {
    return [{ format: formats[0], target: path.resolve(out) }];
  }
  const dir = path.resolve(out ?? DEFAULT_OUT_DIR);
  return formats.map((format) => ({ format, target: path.join(dir, DEFAULT_FILENAMES[format]) }));
}

export async function runReport(opts: RunReportOptions): Promise<RunReportResult> {
  // Validate formats FIRST, before any scan work or filesystem writes, so an
  // unknown/typo'd format fails cleanly with nothing written.
  const validated = validateFormats(opts.formats);
  if ('error' in validated) {
    return { exitCode: 2, output: validated.error };
  }
  const formats = validated.formats;

  // GATING — WHOLE-REQUEST, NOT PER-ARTIFACT (deliberate design decision).
  //
  // If ANY requested format in this single invocation is gated, the request
  // needs a valid key; without one we refuse the ENTIRE request (write nothing,
  // exit 3) even if a free `sbom-cyclonedx` was also requested alongside. A
  // request for ONLY `sbom-cyclonedx` (even repeated) needs no key and proceeds
  // exactly as before.
  //
  // Rationale: gating per-artifact-within-one-invocation would mean partially
  // fulfilling a request (writing the free SBOM, skipping the paid HTML) and
  // then having to pick a mixed exit code — a confusing "some of what you asked
  // for" outcome and a write/skip matrix to reason about. Whole-request gating
  // is unambiguous: the invocation either fully succeeds or writes nothing, and
  // it matches how the brief frames the free-cyclonedx path as its own separate
  // step rather than mixed into a gated multi-format request.
  const needsKey = formats.some((f) => GATED_FORMATS.has(f));
  let license: LicenseInfo | null = null;
  if (needsKey) {
    const keyString = discoverLicenseKey({
      cliKey: opts.key,
      env: opts.env,
      keyFilePath: opts.keyFilePath,
    });
    license = keyString ? verifyLicenseKey(keyString) : null;
    if (!license) {
      // Refuse the whole request. Nothing is scanned, nothing is written.
      return { exitCode: EXIT_UNLICENSED, output: UNLICENSED_MESSAGE };
    }
  }

  let data: ReportData;
  try {
    data = await buildReportData(opts.path, {
      productionOnly: opts.productionOnly,
      projectLicenseOverride: opts.projectLicenseOverride,
    });
  } catch (err) {
    if (err instanceof NoProjectFoundError) {
      // Match the `scan` command's exit-2 "no project" style, extended to name
      // the `report` command. Nothing is written.
      return { exitCode: 2, output: `licenseproof report: ${err.message}. No artifacts were generated.` };
    }
    return { exitCode: 2, output: `licenseproof report: ${(err as Error).message}` };
  }

  const targets = resolveOutputTargets(formats, opts.out);
  const written: string[] = [];
  try {
    for (const { format, target } of targets) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = await renderFormat(format, data);
      fs.writeFileSync(target, content);
      written.push(target);
    }
  } catch (err) {
    return { exitCode: 2, output: `licenseproof report: ${(err as Error).message}` };
  }

  const lines = [
    `licenseproof: wrote ${written.length} report artifact${written.length === 1 ? '' : 's'}:`,
    ...written.map((w) => `  ${w}`),
  ];

  // Data-currency FYI (addendum §2): when a gated format was generated with a
  // valid key AND the installed reference data postdates the key's update
  // window, append ONE purely informational line. Report generation is
  // perpetual and completely unaffected — this never nags, degrades, or blocks.
  if (license) {
    const note = dataCurrencyNote(license.updatesUntil, data.dataVersion);
    if (note) lines.push('', note);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
