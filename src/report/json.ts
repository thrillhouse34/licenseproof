import type { LicenseCategory, ConfidenceLevel, ResolutionSource } from '../resolve/types';
import type { ConflictResult } from '../rules/conflicts';
import type { EcosystemId } from '../ecosystems/types';
import type { ReportMetadata } from './reportData';
import { classifySeverity, SEVERITY_ORDER } from './severity';

export interface JsonPackageEntry {
  name: string;
  version: string;
  ecosystem: EcosystemId;
  direct: boolean;
  dev: boolean;
  license: string;
  licenseIds: string[];
  category: LicenseCategory;
  confidence: ConfidenceLevel;
  source: ResolutionSource;
  normalizedFrom?: string;
  conflict: ConflictResult;
  paths: string[][];
  pathCountAtLeast: number;
  hasDiskPath: boolean;
}

export interface JsonReport {
  schemaVersion: 1;
  toolVersion: string;
  dataVersion: string;
  scanTimestamp: string;
  projectName: string;
  projectLicense: { id: string; wasUnspecified: boolean };
  summary: {
    totalPackages: number;
    conflictCount: number;
    reviewCount: number;
    unknownCount: number;
    agplCount: number;
    agplInformationalCount: number;
    /**
     * Per-ecosystem package counts, keyed by EcosystemId ("npm", "pypi"). Only
     * ecosystems that actually contributed at least one package appear as keys,
     * and the values always sum to `totalPackages`. Additive (Milestone 4) —
     * present even for single-ecosystem scans (one key). Enables consumers to
     * reconcile a merged multi-ecosystem report.
     */
    byEcosystem: Record<string, number>;
  };
  packages: JsonPackageEntry[];
  warnings: string[];
}

// The JSON renderer needs exactly the shared report metadata and nothing more
// (it re-derives byEcosystem/per-package ecosystem straight from `packages`), so
// its input IS the shared `ReportMetadata` base rather than a parallel copy of
// the same seven fields. A full `ReportData` (which additionally carries
// `ecosystems`) is assignable here directly.
export type BuildJsonReportInput = ReportMetadata;

export function buildJsonReport(input: BuildJsonReportInput): JsonReport {
  // Sort the original ResolvedPackage[] via classifySeverity first, then map
  // to JsonPackageEntry[] — avoids re-deriving severity from the already-
  // narrowed JSON entry shape (and the unsafe cast that would require).
  const severityRank = new Map(SEVERITY_ORDER.map((s, i) => [s, i]));
  const sorted = [...input.packages].sort((a, b) => {
    const ra = severityRank.get(classifySeverity(a))!;
    const rb = severityRank.get(classifySeverity(b))!;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  const entries: JsonPackageEntry[] = sorted.map((p) => ({
    name: p.name,
    version: p.version,
    ecosystem: p.ecosystem,
    direct: p.direct,
    dev: p.dev,
    license: p.license,
    licenseIds: p.licenseIds,
    category: p.category,
    confidence: p.confidence,
    source: p.source,
    normalizedFrom: p.normalizedFrom,
    conflict: p.conflict,
    paths: p.paths,
    pathCountAtLeast: p.pathCountAtLeast,
    hasDiskPath: p.diskPath !== undefined,
  }));

  // agplCount: any package with conflict.agplNetworkedUse true, regardless of
  // conflict.level (unchanged, pre-existing semantics).
  const agplCount = input.packages.filter((p) => p.conflict.agplNetworkedUse).length;
  const conflictCount = input.packages.filter((p) => p.conflict.level === 'CONFLICT').length;
  const unknownCount = input.packages.filter((p) => p.category === 'unknown').length;
  const reviewCount = input.packages.filter((p) => p.conflict.level === 'REVIEW' && p.category !== 'unknown').length;
  // agplInformationalCount: the narrower 'agpl-informational' severity bucket
  // the terminal renderer already computes (src/report/summary.ts) — AGPL
  // present only as a non-chosen OR branch, conflict.level is NONE. Reuses
  // classifySeverity directly rather than hand-rolling a second definition of
  // "informational", per the PERMISSIVE_IDS duplication lesson from M3 P3.
  const agplInformationalCount = input.packages.filter((p) => classifySeverity(p) === 'agpl-informational').length;

  // Per-ecosystem package counts. Derived from each package's own `ecosystem`
  // tag (never lost in the merge), so the values always sum to totalPackages.
  const byEcosystem: Record<string, number> = {};
  for (const p of input.packages) {
    byEcosystem[p.ecosystem] = (byEcosystem[p.ecosystem] ?? 0) + 1;
  }

  return {
    schemaVersion: 1,
    toolVersion: input.toolVersion,
    dataVersion: input.dataVersion,
    scanTimestamp: input.scanTimestamp,
    projectName: input.projectName,
    projectLicense: input.projectLicense,
    summary: { totalPackages: input.packages.length, conflictCount, reviewCount, unknownCount, agplCount, agplInformationalCount, byEcosystem },
    packages: entries,
    warnings: input.warnings,
  };
}
