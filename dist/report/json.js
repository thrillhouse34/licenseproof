"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJsonReport = buildJsonReport;
const severity_1 = require("./severity");
function buildJsonReport(input) {
    // Sort the original ResolvedPackage[] via classifySeverity first, then map
    // to JsonPackageEntry[] — avoids re-deriving severity from the already-
    // narrowed JSON entry shape (and the unsafe cast that would require).
    const severityRank = new Map(severity_1.SEVERITY_ORDER.map((s, i) => [s, i]));
    const sorted = [...input.packages].sort((a, b) => {
        const ra = severityRank.get((0, severity_1.classifySeverity)(a));
        const rb = severityRank.get((0, severity_1.classifySeverity)(b));
        if (ra !== rb)
            return ra - rb;
        return a.name.localeCompare(b.name);
    });
    const entries = sorted.map((p) => ({
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
    const agplInformationalCount = input.packages.filter((p) => (0, severity_1.classifySeverity)(p) === 'agpl-informational').length;
    // Per-ecosystem package counts. Derived from each package's own `ecosystem`
    // tag (never lost in the merge), so the values always sum to totalPackages.
    const byEcosystem = {};
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
//# sourceMappingURL=json.js.map