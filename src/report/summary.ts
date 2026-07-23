import pc from 'picocolors';
import type { ResolvedPackage, LicenseCategory } from '../resolve/types';
import type { ReportMetadata } from './reportData';
import { classifySeverity, SEVERITY_ORDER, type Severity } from './severity';
import { explanationFor, formatChain, agplAlternativeNote } from './findingText';

// The terminal renderer needs the shared report metadata PLUS `colorEnabled` (a
// display concern, not report data), so its input extends the shared
// `ReportMetadata` base rather than re-declaring the same seven fields. A full
// `ReportData` is assignable to the base half; the CLI supplies `colorEnabled`.
export interface SummaryInput extends ReportMetadata {
  colorEnabled: boolean;
}

interface Colors {
  bold: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
}

// Explicit wrapper rather than `pc as unknown as Colors` — picocolors's real
// Formatter type (`(input: string | number | null | undefined) => string`) is
// wider than what we need, so this assigns cleanly with no cast required.
//
// picocolors's default export auto-detects TTY/NO_COLOR/CI itself and silently
// no-ops outside a real terminal (e.g. under vitest, or when piped) — using
// `pc.red` etc. directly would make `colorEnabled: true` a lie in exactly the
// environments where that matters most for testing. `createColors(enabled)`
// force-overrides that auto-detection so `colorEnabled` is the single source
// of truth; the caller (CLI layer) is responsible for its own TTY/--no-color
// detection before setting it.
function colorsFor(enabled: boolean): Colors {
  const forced = pc.createColors(enabled);
  return { bold: forced.bold, red: forced.red, yellow: forced.yellow, cyan: forced.cyan, dim: forced.dim };
}

// Fixed, deliberate reading order (least to most restrictive) — not
// insertion order or alphabetical, so the category-totals section always
// reads the same way regardless of which categories happen to be present.
const CATEGORY_ORDER: LicenseCategory[] = ['permissive', 'public-domain', 'weak-copyleft', 'strong-copyleft', 'noncommercial', 'unknown'];

function wrapAt80(text: string, indent: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = indent;
  for (const word of words) {
    if ((current + word).length > 80 && current.trim().length > 0) {
      lines.push(current.trimEnd());
      current = indent;
    }
    current += word + ' ';
  }
  if (current.trim().length > 0) lines.push(current.trimEnd());
  return lines.join('\n');
}

function renderPackageEntry(pkg: ResolvedPackage, c: Colors, labelColor: (s: string) => string): string {
  const lines: string[] = [];
  lines.push(labelColor(wrapAt80(`${pkg.name}@${pkg.version} — ${pkg.license}`, '  ')));
  lines.push(c.dim(wrapAt80(formatChain(pkg), '    ')));
  const explanation = explanationFor(pkg.conflict.explanationKey);
  if (explanation) lines.push(c.dim(wrapAt80(explanation, '    ')));
  return lines.join('\n');
}

export function renderSummary(input: SummaryInput): string {
  const c: Colors = colorsFor(input.colorEnabled);
  const lines: string[] = [];

  const total = input.packages.length;

  const buckets: Record<Severity, ResolvedPackage[]> = { conflict: [], 'agpl-informational': [], review: [], unknown: [], clean: [] };
  for (const p of input.packages) buckets[classifySeverity(p)].push(p);
  for (const key of SEVERITY_ORDER) buckets[key].sort((a, b) => a.name.localeCompare(b.name));

  // ---- Header ----
  lines.push(c.bold(`LicenseProof scan: ${input.projectName}`));
  lines.push(`Project license: ${input.projectLicense.id}`);
  if (input.projectLicense.wasUnspecified) {
    lines.push(c.yellow(wrapAt80('No license declared or recognized for this project (unspecified) — assuming the strictest, proprietary-equivalent conflict rules.', '  ')));
    lines.push(c.yellow('  Pass --project-license <SPDX id> to override this assumption.'));
  }
  // Per-ecosystem package counts, derived from each package's own `ecosystem`
  // tag (robust to the multi-ecosystem merge). The breakdown suffix is only
  // appended for a genuinely mixed scan (2+ ecosystems contributed packages) —
  // for a single-ecosystem scan the total already IS that ecosystem's count, so
  // "(npm: N)" would be redundant noise and would needlessly change the existing
  // npm-only output. Fixed reading order (npm before pypi) for stable output.
  const ecoCounts = new Map<string, number>();
  for (const p of input.packages) ecoCounts.set(p.ecosystem, (ecoCounts.get(p.ecosystem) ?? 0) + 1);
  const ECOSYSTEM_ORDER: string[] = ['npm', 'pypi'];
  let countsLine =
    `${total} package${total === 1 ? '' : 's'} scanned — ${buckets.conflict.length} conflict, ` +
    `${buckets['agpl-informational'].length} agpl-noted, ${buckets.review.length} review, ${buckets.unknown.length} unknown`;
  if (ecoCounts.size > 1) {
    const ordered = [...ecoCounts.keys()].sort(
      (a, b) => (ECOSYSTEM_ORDER.indexOf(a) + 1 || 99) - (ECOSYSTEM_ORDER.indexOf(b) + 1 || 99),
    );
    const breakdown = ordered.map((e) => `${e}: ${ecoCounts.get(e)}`).join(', ');
    countsLine += ` (${breakdown})`;
  }
  // A mixed scan with many packages / long ecosystem names can push this past 80
  // columns (M3's "ordinary case that overflows" lesson), so wrap it like every
  // other header line. wrapAt80 is a no-op on the sub-80 single-ecosystem line,
  // keeping existing output byte-identical.
  lines.push(wrapAt80(countsLine, ''));
  lines.push(c.dim(`licenseproof ${input.toolVersion} · data ${input.dataVersion} · scanned ${input.scanTimestamp}`));

  // ---- Category totals ----
  const byCategory = new Map<LicenseCategory, number>();
  for (const p of input.packages) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  lines.push('');
  lines.push(c.bold('By category:'));
  for (const cat of CATEGORY_ORDER) {
    const count = byCategory.get(cat);
    if (count) lines.push(`  ${cat}: ${count}`);
  }

  // ---- Severity-ordered sections: CONFLICT, AGPL-informational, REVIEW, UNKNOWN ----
  if (buckets.conflict.length > 0) {
    lines.push('');
    lines.push(c.bold(c.red(`CONFLICT (${buckets.conflict.length}):`)));
    for (const pkg of buckets.conflict) lines.push(renderPackageEntry(pkg, c, (s) => c.red(s)));
  }

  if (buckets['agpl-informational'].length > 0) {
    lines.push('');
    lines.push(c.bold(c.cyan(`AGPL noted, informational — not blocking (${buckets['agpl-informational'].length}):`)));
    for (const pkg of buckets['agpl-informational']) {
      lines.push(c.cyan(wrapAt80(`${pkg.name}@${pkg.version} — ${pkg.license}`, '  ')));
      lines.push(c.dim(wrapAt80(formatChain(pkg), '    ')));
      lines.push(c.dim(wrapAt80(agplAlternativeNote(pkg), '    ')));
    }
  }

  if (buckets.review.length > 0) {
    lines.push('');
    lines.push(c.bold(c.yellow(`REVIEW (${buckets.review.length}):`)));
    for (const pkg of buckets.review) lines.push(renderPackageEntry(pkg, c, (s) => c.yellow(s)));
  }

  if (buckets.unknown.length > 0) {
    lines.push('');
    lines.push(c.bold(`UNKNOWN (${buckets.unknown.length}):`));
    for (const pkg of buckets.unknown) lines.push(renderPackageEntry(pkg, c, (s) => s));
  }

  if (input.warnings.length > 0) {
    lines.push('');
    lines.push(c.bold(c.yellow('Warnings:')));
    for (const w of input.warnings) lines.push(c.yellow(`  - ${w}`));
  }

  return lines.join('\n');
}
