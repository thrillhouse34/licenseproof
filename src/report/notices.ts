import * as fs from 'fs';
import * as path from 'path';
import type { ReportData } from './reportData';
import type { ResolvedPackage } from '../resolve/types';
import { DATA_DIR } from '../paths';
import { readLicenseFile } from '../resolve/resolveProject';

// Plain-text THIRD_PARTY_NOTICES.txt generation (Milestone 5 Task 4).
//
// Groups every ResolvedPackage by its resolved `license` display string — the
// SAME string already shown in terminal/JSON output (full OR/WITH expressions
// verbatim where that's what actually resolved, never simplified). Each group
// lists every package under it, followed once by that license's full text,
// tried in this priority order and NEVER fabricated:
//   (a) vendored text in data/license-texts/<id>.txt (only ~14 ids vendored —
//       most real-world scans will exercise (b)/(c) below, not just (a));
//   (b) the package's own on-disk license file, read via its confirmed
//       `diskPath` reusing resolveProject.ts's exact readLicenseFile logic;
//   (c) an honest "text unavailable" note — no guessing, no silent omission.

const SEPARATOR = '='.repeat(80);
const RULE = '-'.repeat(80);

let vendoredIdsCache: Set<string> | undefined;

/**
 * The exact set of ids that have vendored full text, derived from the real
 * directory listing rather than assumed — reading this once and checking
 * membership (rather than blindly `path.join`-ing the untrusted `license`
 * display string and calling `fs.existsSync`) means an adversarial
 * package-declared "license" value (e.g. containing `../`) can never be used
 * to probe or read a file outside `data/license-texts/`: only a filename that
 * is ALREADY confirmed to exist in that directory's own listing is ever
 * turned into a path.
 */
function vendoredLicenseIds(): Set<string> {
  if (!vendoredIdsCache) {
    const dir = path.join(DATA_DIR, 'license-texts');
    vendoredIdsCache = new Set(
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => f.slice(0, -'.txt'.length)),
    );
  }
  return vendoredIdsCache;
}

function vendoredLicenseText(licenseString: string): string | undefined {
  if (!vendoredLicenseIds().has(licenseString)) return undefined;
  const filePath = path.join(DATA_DIR, 'license-texts', `${licenseString}.txt`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Try every package in the group that has a confirmed `diskPath`, in order,
 * until one yields real on-disk license file content. `diskPath` is relative
 * to `projectPath` (see `ReportData.projectPath`'s doc comment) — never
 * usable on its own. `projectPath` is optional on `ReportData` (kept that way
 * so other renderers' hand-built test fixtures don't all need to supply a
 * filesystem path they never use) — when it's absent there is no way to
 * locate any on-disk file at all, so this tier is skipped entirely and the
 * caller falls through to the honest "unavailable" note, never guesses.
 */
function onDiskLicenseText(projectPath: string | undefined, pkgs: ResolvedPackage[]): string | undefined {
  if (!projectPath) return undefined;
  for (const pkg of pkgs) {
    if (!pkg.diskPath) continue;
    const absoluteDir = path.join(projectPath, pkg.diskPath);
    const text = readLicenseFile(absoluteDir);
    if (text) return text;
  }
  return undefined;
}

function formatPackageLine(pkg: ResolvedPackage): string {
  return `  - ${pkg.name}@${pkg.version}`;
}

export function renderNotices(data: ReportData): string {
  const groups = new Map<string, ResolvedPackage[]>();
  for (const pkg of data.packages) {
    const list = groups.get(pkg.license);
    if (list) list.push(pkg);
    else groups.set(pkg.license, [pkg]);
  }

  // Fixed, deterministic group order (alphabetical by license string) rather
  // than first-seen/insertion order, so output is stable across runs and
  // across the same dependency tree resolved in a different scan order.
  const orderedLicenses = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  lines.push('THIRD-PARTY NOTICES');
  lines.push(data.projectName);
  lines.push('');
  // Established phrasing (matches the HTML report's cover-header scope line
  // and the README's "informational categorization, not legal advice" —
  // reused verbatim rather than re-worded for this artifact).
  lines.push('Informational license categorization — not legal advice.');
  lines.push(`licenseproof ${data.toolVersion} · data ${data.dataVersion} · scanned ${data.scanTimestamp}`);
  lines.push('');
  lines.push(
    "This file lists every third-party package detected in this project, grouped by resolved " +
      "license, followed by that license's full text where available.",
  );
  lines.push('');

  for (const license of orderedLicenses) {
    const pkgs = [...groups.get(license)!].sort(
      (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );

    lines.push(SEPARATOR);
    lines.push(license);
    lines.push(SEPARATOR);
    lines.push('');
    lines.push(`Packages under this license (${pkgs.length}):`);
    for (const pkg of pkgs) lines.push(formatPackageLine(pkg));
    lines.push('');
    lines.push(RULE);
    lines.push('');

    const text =
      vendoredLicenseText(license) ??
      onDiskLicenseText(data.projectPath, pkgs) ??
      `[License text unavailable for "${license}" — no vendored text and no license file found on disk.]`;
    lines.push(text.trimEnd());
    lines.push('');
  }

  return lines.join('\n');
}
