import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../paths';
import type { LicenseCategory } from '../resolve/types';
import type { SpdxExpression } from '../resolve/spdxParser';
import { flattenLicenseIds } from '../resolve/spdxParser';

interface CategoryDataFile { schemaVersion: number; categories: Record<string, LicenseCategory> }
let cached: CategoryDataFile | undefined;
function load(): CategoryDataFile {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'license-categories.json'), 'utf8'));
  return cached!;
}

export function categorizeLicenseId(id: string): LicenseCategory {
  return load().categories[id] ?? 'unknown';
}

// Riskiest-first: a set of ids mixing categories must surface the most
// restrictive one present, since conflict logic needs the riskiest license
// actually in play, not the most permissive.
const RISK_ORDER: LicenseCategory[] = ['strong-copyleft', 'noncommercial', 'weak-copyleft', 'unknown', 'permissive', 'public-domain'];

export function categorizeIds(ids: string[]): LicenseCategory {
  const categories = ids.map(categorizeLicenseId);
  for (const risk of RISK_ORDER) if (categories.includes(risk)) return risk;
  return 'unknown';
}

export function categorizeExpression(expr: SpdxExpression): LicenseCategory {
  return categorizeIds(flattenLicenseIds(expr));
}

// License "families": groups of SPDX ids that are versioned/variant members of the
// SAME underlying license lineage. These are deliberately the exact set of families
// where PyPI's generic Trove classifiers (data/classifier-to-spdx.json) collapse a
// genuinely-ambiguous classifier onto ONE representative variant — e.g.
// "License :: OSI Approved :: BSD License" -> BSD-3-Clause even though BSD-2-Clause is
// equally plausible; "GNU General Public License (GPL)" -> GPL-3.0-only; "GNU Library or
// Lesser General Public License (LGPL)" -> LGPL-2.1-only; "Apache Software License",
// "Artistic License", and "Academic Free License (AFL)" likewise. That data file's own
// `note` documents these representative mappings as safe because the candidates share a
// category. The PyPI resolver uses this to avoid flagging a metadata-vs-classifier
// "disagreement" that is really just same-family variant ambiguity.
//
// GPL / LGPL / AGPL are kept as SEPARATE families on purpose: they are related but
// genuinely distinct licenses in different categories (strong-copyleft / weak-copyleft /
// strong-copyleft), so a GPL-vs-LGPL or GPL-vs-AGPL cross-signal mismatch is a REAL
// disagreement that must still surface. AGPL is intentionally absent here (its classifiers
// map to specific AGPL ids, never a generic representative), so it never suppresses.
const LICENSE_FAMILIES: readonly (readonly string[])[] = [
  ['0BSD', 'BSD-1-Clause', 'BSD-2-Clause', 'BSD-2-Clause-Patent', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause'],
  ['Apache-1.0', 'Apache-1.1', 'Apache-2.0'],
  ['Artistic-1.0', 'Artistic-1.0-Perl', 'Artistic-1.0-cl8', 'Artistic-2.0'],
  ['GPL-1.0-only', 'GPL-1.0-or-later', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later'],
  ['LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later'],
  ['AFL-1.1', 'AFL-1.2', 'AFL-2.0', 'AFL-2.1', 'AFL-3.0'],
];

const ID_TO_FAMILY: Map<string, number> = (() => {
  const m = new Map<string, number>();
  LICENSE_FAMILIES.forEach((family, i) => family.forEach((id) => m.set(id, i)));
  return m;
})();

// True iff both ids belong to the SAME known license family (see LICENSE_FAMILIES).
// Ids not in any family (MIT, ISC, MPL-2.0, AGPL-3.0-only, ...) never share a family —
// not even with themselves — so this only ever suppresses genuine same-lineage variant
// ambiguity, never a cross-license match. Callers should handle exact-id equality
// separately; this answers the narrower "same family, different variant" question.
export function sameLicenseFamily(a: string, b: string): boolean {
  const fa = ID_TO_FAMILY.get(a);
  return fa !== undefined && fa === ID_TO_FAMILY.get(b);
}
