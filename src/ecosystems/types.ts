export type EcosystemId = 'npm' | 'pypi';

export interface ScannedPackage {
  name: string;
  version: string;
  ecosystem: EcosystemId;
  direct: boolean;
  dev: boolean;
  paths: string[][];
  pathCountAtLeast: number;
  licenseRaw?: string;
  /**
   * The primary candidate location this package would be installed at,
   * computed purely from the lockfile's own structure (e.g.
   * "node_modules/left-pad", or for pnpm the top-level symlink path) —
   * NEVER verified against the filesystem. This is a declaration, not a
   * fact: the package may not actually be there (e.g. a pnpm package only
   * reachable via its real .pnpm content directory, not the symlink).
   */
  installPath: string;
  /**
   * The real on-disk directory the fs-owning orchestrator actually
   * confirmed this package exists at (checked against every internal
   * candidate path, not just `installPath`), or undefined if none of the
   * candidates were found on disk. Only the orchestrator ever sets this —
   * nothing downstream re-derives or guesses it. The resolution pipeline
   * (Milestone 2) must read LICENSE/README files via THIS field, and must
   * skip all disk-based resolution steps (falling through to the next
   * pipeline step) when it is undefined.
   */
  diskPath?: string;
}

export type LockfileKind =
  // npm ecosystem
  | 'package-lock'
  | 'pnpm'
  | 'yarn-classic'
  | 'yarn-berry'
  // pypi ecosystem (Milestone 4). Each is the actual manifest/lockfile tier that
  // won the pypi precedence chain (uv.lock > poetry.lock > requirements.txt >
  // pyproject.toml declared-only), so a pypi ScanResult now truthfully reports
  // which file it read instead of the `'none'` placeholder used before Task 7.
  | 'poetry-lock'
  | 'uv-lock'
  | 'requirements-txt'
  | 'pyproject-declared'
  // no lockfile/manifest tier applied (e.g. detect() matched but nothing parseable)
  | 'none';

export interface ScanResult {
  projectName: string;
  projectVersion?: string;
  ecosystems: EcosystemId[];
  lockfile: LockfileKind;
  packages: ScannedPackage[];
  warnings: string[];
  /** The scanned project's own declared `license` field from its package.json, when it's a plain string. Absent (not "unspecified" — the CLI layer decides that) if the field is missing or isn't a string (legacy object/array license field shapes). */
  projectLicenseRaw?: string;
}

export interface ScanOptions {
  productionOnly: boolean;
}

export interface Ecosystem {
  id: EcosystemId;
  detect(projectPath: string): boolean;
  scan(projectPath: string, opts: ScanOptions): Promise<ScanResult>;
}
