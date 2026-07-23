import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedPackage } from '../resolve/types';
import { DATA_DIR } from '../paths';

// ─────────────────────────────────────────────────────────────────────────────
// Shared finding-rendering text helpers, reused by EVERY renderer that describes
// a package finding (the terminal summary and the HTML report today; PDF renders
// the HTML, so it inherits these for free). Kept in exactly one place — like
// `severity.ts` for the ordering and `PERMISSIVE_IDS` for the id set — so the
// terminal and the lawyer-facing HTML artifact can never silently say different
// things about the same package. The whole point of the vendored, reviewed
// explanation strings (spec §4.4) is that they render identically everywhere;
// a second copy of any of this logic would defeat that.
// ─────────────────────────────────────────────────────────────────────────────

let explanationsCache: Record<string, string> | undefined;

/**
 * The vendored, reviewed plain-English explanation for a conflict reason code,
 * read verbatim from `data/conflict-explanations.json`. Never rewritten,
 * paraphrased, or "friendlied up" for a particular output format. Returns
 * `undefined` for a null key (a clean package carries `explanationKey: null`).
 */
export function explanationFor(key: string | null): string | undefined {
  if (!key) return undefined;
  if (!explanationsCache) {
    explanationsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'conflict-explanations.json'), 'utf8')).explanations;
  }
  return explanationsCache![key];
}

/**
 * The single canonical dependency-chain phrasing. Shows the primary chain and,
 * when the enumeration cap was hit, the "at least N other paths" floor.
 *
 * `pathCountAtLeast` is a floor established by the path-enumeration cap
 * (Milestone 1), never an exact count once the cap is hit — "at least N"
 * phrasing is mandatory so the number is never misread as a precise total.
 */
export function formatChain(pkg: ResolvedPackage): string {
  const chain = (pkg.paths[0] ?? [pkg.name]).join(' → ');
  const extra = pkg.pathCountAtLeast - 1;
  if (extra <= 0) return `via ${chain}`;
  return `via ${chain} (+at least ${extra.toLocaleString()} other path${extra === 1 ? '' : 's'})`;
}

/**
 * The informational note shown for an `agpl-informational` finding — a package
 * whose AGPL branch is a NON-chosen alternative (the selected branch is clean),
 * so it is surfaced for awareness but is not a conflict.
 *
 * `pkg.license` is the raw declared expression (e.g. "MIT OR AGPL-3.0-only") and
 * still includes the AGPL branch — using it here would read as "usable under
 * MIT OR AGPL-3.0-only", contradicting the whole point of this note. Show only
 * the non-AGPL id(s) that make the chosen branch clean.
 */
export function agplAlternativeNote(pkg: ResolvedPackage): string {
  const nonAgplIds = pkg.licenseIds.filter((id) => !id.toUpperCase().startsWith('AGPL-'));
  const usableUnder = nonAgplIds.length > 0 ? nonAgplIds.join(' or ') : pkg.license;
  return `AGPL appears as an alternative license; package usable under ${usableUnder}.`;
}
