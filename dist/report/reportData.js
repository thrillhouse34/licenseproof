"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoProjectFoundError = void 0;
exports.buildReportData = buildReportData;
const npm_1 = require("../ecosystems/npm");
const pypi_1 = require("../ecosystems/pypi");
const resolveProject_1 = require("../resolve/resolveProject");
const projectLicense_1 = require("../resolve/projectLicense");
const toolVersion_1 = require("../toolVersion");
/**
 * Thrown by `buildReportData` when neither ecosystem detects a project at `path`.
 * Its `.message` is the exact marker-listing sentence the CLI layers surface
 * (each prefixes its own `licenseproof[: ...]` framing), so the "no project"
 * output stays identical to the pre-extraction behavior for `scan` and can be
 * extended to mention `report` for the new command.
 */
class NoProjectFoundError extends Error {
    constructor(path) {
        super(`no supported project found at ${path} (looked for package.json, and pyproject.toml / requirements.txt / poetry.lock / uv.lock)`);
        this.name = 'NoProjectFoundError';
    }
}
exports.NoProjectFoundError = NoProjectFoundError;
/**
 * Merge the ScanResults of every ecosystem that detected into a single combined
 * view for the downstream resolution + reporting layers. A project can carry BOTH
 * an npm and a pypi surface side by side (a mixed repo), so this is a real merge,
 * not a pick-one.
 *
 * `projectLicenseRaw` tie-break (a genuine mixed-repo edge case the brief leaves
 * unspecified): when both ecosystems declare a project license and they DIFFER,
 * we use the npm-declared one and emit a non-silent warning. Rationale: in a
 * mixed JS+Python repo the `package.json` is more often the "primary" project
 * marker, and a deterministic, disclosed rule beats a silent pick. (The
 * considered alternative — deriving both conflict modes and taking the stricter —
 * was rejected as less predictable and only ever differing in rare cross-family
 * declarations; either is defensible, this one is disclosed here and at runtime.)
 * A user can always override the whole question with `--project-license`, which
 * wins over both inside `resolveProjectLicenseContext`.
 *
 * `lockfile`: each ecosystem's own ScanResult already reports the exact
 * manifest/lockfile tier it used (see LockfileKind's pypi kinds), so no
 * information about "which lockfile each ecosystem used" is lost. The merged
 * object needs a single `lockfile` for type shape only; nothing downstream
 * (resolveProject reads only `.packages`; the reporters don't read it at all)
 * consumes it, so we surface the npm kind when npm is present, else the pypi
 * kind — a coarse summary, never a substitute for the per-ecosystem detail.
 */
function mergeScanResults(results) {
    const npm = results.find((r) => r.ecosystems.includes('npm'));
    const pypi = results.find((r) => r.ecosystems.includes('pypi'));
    const packages = results.flatMap((r) => r.packages);
    const warnings = results.flatMap((r) => r.warnings);
    const ecosystems = results.flatMap((r) => r.ecosystems);
    // Project name: prefer npm's (package.json name) when present, else pypi's.
    const projectName = npm?.projectName ?? pypi?.projectName ?? results[0]?.projectName ?? '';
    const projectVersion = npm?.projectVersion ?? pypi?.projectVersion;
    const npmLicense = npm?.projectLicenseRaw;
    const pypiLicense = pypi?.projectLicenseRaw;
    let projectLicenseRaw = npmLicense ?? pypiLicense;
    let projectLicenseWarning;
    if (npmLicense && pypiLicense && npmLicense.trim() !== pypiLicense.trim()) {
        projectLicenseRaw = npmLicense;
        projectLicenseWarning =
            `Project declares different licenses in package.json (${npmLicense}) and ` +
                `pyproject.toml (${pypiLicense}). Using the npm-declared license ` +
                `(${npmLicense}) for conflict checking. Pass --project-license <SPDX id> to override.`;
    }
    const merged = {
        projectName,
        projectVersion,
        ecosystems,
        lockfile: npm?.lockfile ?? pypi?.lockfile ?? 'none',
        packages,
        warnings,
        projectLicenseRaw,
    };
    return { merged, projectLicenseWarning };
}
/**
 * The shared "detect both ecosystems, scan whichever are present, merge, resolve
 * the project-license context, run resolveProject, stamp tool/data version +
 * scan timestamp" sequence. Extracted verbatim from `runScan`'s former inline
 * body so BOTH the free `scan` command and the M5 `report` command render from
 * the exact same data with zero divergence (Milestone 5 Global Constraint: no
 * resolution-logic changes, no second copy of the Task 7 merge logic).
 *
 * Throws `NoProjectFoundError` when nothing is detected; the CLI layers catch it
 * and turn it into their exit-2 "no project" message.
 */
async function buildReportData(path, opts) {
    // Detect BOTH ecosystems independently — they are not mutually exclusive; a
    // mixed repo can carry a package.json AND a pyproject.toml/requirements.txt.
    const npmDetected = npm_1.npmEcosystem.detect(path);
    const pypiDetected = pypi_1.pypiEcosystem.detect(path);
    if (!npmDetected && !pypiDetected) {
        throw new NoProjectFoundError(path);
    }
    const scanOpts = { productionOnly: opts.productionOnly };
    const results = [];
    if (npmDetected)
        results.push(await npm_1.npmEcosystem.scan(path, scanOpts));
    if (pypiDetected)
        results.push(await pypi_1.pypiEcosystem.scan(path, scanOpts));
    const { merged, projectLicenseWarning } = mergeScanResults(results);
    if (projectLicenseWarning)
        merged.warnings.push(projectLicenseWarning);
    const projectLicense = (0, projectLicense_1.resolveProjectLicenseContext)(merged.projectLicenseRaw, opts.projectLicenseOverride);
    const { packages, dataVersion } = (0, resolveProject_1.resolveProject)(path, merged, projectLicense.modeId);
    const scanTimestamp = new Date().toISOString();
    const toolVersion = (0, toolVersion_1.getToolVersion)();
    return {
        projectName: merged.projectName,
        packages,
        warnings: merged.warnings,
        projectLicense: { id: projectLicense.displayId, wasUnspecified: projectLicense.wasUnspecified },
        toolVersion,
        dataVersion,
        scanTimestamp,
        ecosystems: merged.ecosystems,
        projectPath: path,
    };
}
//# sourceMappingURL=reportData.js.map