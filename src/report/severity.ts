import type { ResolvedPackage } from '../resolve/types';

export type Severity = 'conflict' | 'agpl-informational' | 'review' | 'unknown' | 'clean';

// Rendering order for both the terminal summary and (as a secondary sort
// key) JSON output — kept in exactly one place so the two renderers can
// never silently diverge, unlike the PERMISSIVE_IDS duplication this
// milestone's pre-work fixed.
export const SEVERITY_ORDER: Severity[] = ['conflict', 'agpl-informational', 'review', 'unknown', 'clean'];

export function classifySeverity(pkg: ResolvedPackage): Severity {
  if (pkg.conflict.level === 'CONFLICT') return 'conflict';
  if (pkg.category === 'unknown') return 'unknown'; // always its own bucket, even though unknown also carries REVIEW level — never buried in a generic review list
  if (pkg.conflict.level === 'REVIEW') return 'review';
  if (pkg.conflict.agplNetworkedUse) return 'agpl-informational'; // AGPL present only as a non-chosen OR branch; the chosen branch itself is clean
  return 'clean';
}
