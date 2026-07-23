import { npmEcosystem } from '../ecosystems/npm';
import { pypiEcosystem } from '../ecosystems/pypi';
import type { EcosystemId, ScanResult } from '../ecosystems/types';
import type { ResolvedPackage } from '../resolve/types';
import { resolveProject } from '../resolve/resolveProject';
import { resolveProjectLicenseContext } from '../resolve/projectLicense';
import { getToolVersion } from '../toolVersion';

/**
 * The common metadata shape every renderer needs. This is the SINGLE canonical
 * definition of "a scan's reportable fields" — the terminal (`SummaryInput`) and
 * JSON (`BuildJsonReportInput`) renderer inputs both derive from it (see
 * summary.ts / json.ts) rather than re-declaring the same seven fields a third
 * and fourth time. Keeping it as a base interface (instead of collapsing all
 * three into one) is deliberate: the terminal renderer additionally needs
 * `colorEnabled` (a display concern, not report data) and the M5 artifact
 * renderers additionally need `ecosystems` — so each consumer extends the base
 * with exactly what it needs and nothing it doesn't. Existing tests construct
 * `SummaryInput`/`BuildJsonReportInput` inline with only these base fields, so
 * the base must NOT require `ecosystems`.
 */
export interface ReportMetadata {
  projectName: string;
  packages: ResolvedPackage[];
  warnings: string[];
  projectLicense: { id: string; wasUnspecified: boolean };
  toolVersion: string;
  dataVersion: string;
  scanTimestamp: string;
}

/**
 * Everything every Milestone 5 artifact renderer (HTML / PDF / notices / SBOM)
 * consumes, produced once by `buildReportData` and passed to each renderer.
 * Adds `ecosystems` to the shared `ReportMetadata` base — the SBOM/notices
 * renderers surface which ecosystems contributed. `ReportData` is a strict
 * superset of both `SummaryInput` (minus `colorEnabled`) and
 * `BuildJsonReportInput`, so a `ReportData` value is assignable to either
 * renderer input directly.
 *
 * `projectPath` (Task 4 addition, optional): the exact same project-root
 * string passed to `resolveProject` below — every `ResolvedPackage.diskPath`
 * is relative to THIS path, never an absolute path or a path relative to
 * `process.cwd()` (see `resolveDiskPath` in `ecosystems/npm.ts` / the PyPI
 * disk resolver). The notices renderer needs it to `path.join` a package's
 * `diskPath` before reading that package's own on-disk license file — without
 * it there is no way to locate the file at all, since `diskPath` by itself is
 * not resolvable. `buildReportData` below always sets it (so real usage always
 * has it); kept optional here — rather than required — solely so `ReportData`
 * literals built by other renderers' tests (which have no reason to touch the
 * filesystem) keep compiling without every one of them needing to supply it.
 * A renderer that needs on-disk access must treat a missing value as "no
 * project root known" and degrade accordingly (see notices.ts), never assume
 * it's present. Not part of the narrower `ReportMetadata` base (terminal/JSON
 * output never touch the filesystem), same reasoning as `ecosystems` above.
 */
export interface ReportData extends ReportMetadata {
  ecosystems: EcosystemId[];
  projectPath?: string;
}

export interface BuildReportDataOptions {
  productionOnly: boolean;
  projectLicenseOverride?: string;
}

/**
 * Thrown by `buildReportData` when neither ecosystem detects a project at `path`.
 * Its `.message` is the exact marker-listing sentence the CLI layers surface
 * (each prefixes its own `licenseproof[: ...]` framing), so the "no project"
 * output stays identical to the pre-extraction behavior for `scan` and can be
 * extended to mention `report` for the new command.
 */
export class NoProjectFoundError extends Error {
  constructor(path: string) {
    super(
      `no supported project found at ${path} (looked for package.json, and pyproject.toml / requirements.txt / poetry.lock / uv.lock)`,
    );
    this.name = 'NoProjectFoundError';
  }
}

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
function mergeScanResults(results: ScanResult[]): { merged: ScanResult; projectLicenseWarning?: string } {
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
  let projectLicenseWarning: string | undefined;
  if (npmLicense && pypiLicense && npmLicense.trim() !== pypiLicense.trim()) {
    projectLicenseRaw = npmLicense;
    projectLicenseWarning =
      `Project declares different licenses in package.json (${npmLicense}) and ` +
      `pyproject.toml (${pypiLicense}). Using the npm-declared license ` +
      `(${npmLicense}) for conflict checking. Pass --project-license <SPDX id> to override.`;
  }

  const merged: ScanResult = {
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
export async function buildReportData(path: string, opts: BuildReportDataOptions): Promise<ReportData> {
  // Detect BOTH ecosystems independently — they are not mutually exclusive; a
  // mixed repo can carry a package.json AND a pyproject.toml/requirements.txt.
  const npmDetected = npmEcosystem.detect(path);
  const pypiDetected = pypiEcosystem.detect(path);

  if (!npmDetected && !pypiDetected) {
    throw new NoProjectFoundError(path);
  }

  const scanOpts = { productionOnly: opts.productionOnly };
  const results: ScanResult[] = [];
  if (npmDetected) results.push(await npmEcosystem.scan(path, scanOpts));
  if (pypiDetected) results.push(await pypiEcosystem.scan(path, scanOpts));

  const { merged, projectLicenseWarning } = mergeScanResults(results);
  if (projectLicenseWarning) merged.warnings.push(projectLicenseWarning);

  const projectLicense = resolveProjectLicenseContext(merged.projectLicenseRaw, opts.projectLicenseOverride);
  const { packages, dataVersion } = resolveProject(path, merged, projectLicense.modeId);
  const scanTimestamp = new Date().toISOString();
  const toolVersion = getToolVersion();

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
