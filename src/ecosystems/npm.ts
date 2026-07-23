import * as fs from 'fs';
import * as path from 'path';
import type { Ecosystem, ScanOptions, ScanResult } from './types';
import { parsePackageLock } from './npm/packageLockParser';
import { parsePnpmLock } from './npm/pnpmLockParser';
import { detectYarnLockFormat, parseYarnClassicLock, parseYarnBerryLock } from './npm/yarnLockParser';

interface RootManifest {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

interface InternalPackage {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  optional: boolean;
  peer: boolean;
  paths: string[][];
  pathCountAtLeast: number;
  licenseRaw?: string;
  installPaths: string[];
}

function detect(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, 'package.json'));
}

function readManifest(projectPath: string): RootManifest {
  const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8');
  return JSON.parse(raw);
}

function resolveDiskPath(projectPath: string, installPaths: string[]): string | undefined {
  for (const candidate of installPaths) {
    const full = path.join(projectPath, candidate);
    if (fs.existsSync(full)) return candidate;
  }
  return undefined;
}

function filterByDiskPresence(projectPath: string, packages: InternalPackage[]): { kept: InternalPackage[]; excludedCount: number } {
  let excludedCount = 0;
  const kept = packages.filter((p) => {
    if (!p.optional && !p.peer) return true;
    const onDisk = resolveDiskPath(projectPath, p.installPaths) !== undefined;
    if (!onDisk) excludedCount++;
    return onDisk;
  });
  return { kept, excludedCount };
}

function toScannedPackages(projectPath: string, packages: InternalPackage[]) {
  return packages.map((p) => ({
    name: p.name,
    version: p.version,
    ecosystem: 'npm' as const,
    direct: p.direct,
    dev: p.dev,
    paths: p.paths,
    pathCountAtLeast: p.pathCountAtLeast,
    licenseRaw: p.licenseRaw,
    installPath: p.installPaths[0],
    diskPath: resolveDiskPath(projectPath, p.installPaths),
  }));
}

function declaredDepsOnlyFallback(manifest: RootManifest, opts: ScanOptions): { packages: InternalPackage[]; warnings: string[] } {
  const packages: InternalPackage[] = [];
  const addAll = (deps: Record<string, string> | undefined, dev: boolean) => {
    if (!deps) return;
    if (dev && opts.productionOnly) return;
    for (const name of Object.keys(deps)) {
      packages.push({ name, version: 'unresolved (no lockfile)', direct: true, dev, optional: false, peer: false, paths: [[name]], pathCountAtLeast: 1, installPaths: [`node_modules/${name}`] });
    }
  };
  addAll(manifest.dependencies, false);
  addAll(manifest.devDependencies, true);
  return {
    packages,
    warnings: ['No package-lock.json, pnpm-lock.yaml, or yarn.lock found. Reporting declared top-level dependencies only — the transitive tree is incomplete and versions are unresolved.'],
  };
}

function nodeModulesWalkFallback(
  projectPath: string,
  manifest: RootManifest,
  opts: ScanOptions,
): { packages: InternalPackage[]; warnings: string[] } {
  const nodeModulesPath = path.join(projectPath, 'node_modules');
  const declaredDeps = new Set(Object.keys(manifest.dependencies ?? {}));
  const declaredDevDeps = new Set(Object.keys(manifest.devDependencies ?? {}));

  const packageDirs: string[] = [];
  for (const entry of fs.readdirSync(nodeModulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesPath, entry.name);
      for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) packageDirs.push(`${entry.name}/${scoped.name}`);
      }
    } else if (!entry.name.startsWith('.')) {
      packageDirs.push(entry.name);
    }
  }

  const packages: InternalPackage[] = [];
  for (const name of packageDirs) {
    const pkgJsonPath = path.join(nodeModulesPath, name, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    let pkgJson: { version?: string; license?: string };
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue; // malformed package.json on disk — skip rather than crash the whole scan
    }

    const isDev = declaredDevDeps.has(name) && !declaredDeps.has(name);
    if (opts.productionOnly && isDev) continue;

    packages.push({
      name,
      version: pkgJson.version ?? 'unknown',
      direct: declaredDeps.has(name) || declaredDevDeps.has(name),
      dev: isDev,
      optional: false,
      peer: false,
      paths: [[name]],
      pathCountAtLeast: 1,
      licenseRaw: pkgJson.license,
      installPaths: [`node_modules/${name}`],
    });
  }

  return {
    packages,
    warnings: [
      'No package-lock.json, pnpm-lock.yaml, or yarn.lock found. Walked node_modules directly — the true dependency chain (direct vs. transitive nesting) is not reconstructed, only top-level installed packages are listed.',
    ],
  };
}

async function scan(projectPath: string, opts: ScanOptions): Promise<ScanResult> {
  const manifest = readManifest(projectPath);
  const warnings: string[] = [];

  const hasWorkspaces = !!manifest.workspaces;
  if (hasWorkspaces) {
    warnings.push('Monorepo workspaces not supported in v1 — scanning root package only.');
  }

  const packageLockPath = path.join(projectPath, 'package-lock.json');
  const pnpmLockPath = path.join(projectPath, 'pnpm-lock.yaml');
  const yarnLockPath = path.join(projectPath, 'yarn.lock');

  let lockfileKind: ScanResult['lockfile'] = 'none';
  let parsed: { packages: InternalPackage[]; warnings: string[] };

  if (fs.existsSync(packageLockPath)) {
    lockfileKind = 'package-lock';
    parsed = parsePackageLock(fs.readFileSync(packageLockPath, 'utf8'), opts);
  } else if (fs.existsSync(pnpmLockPath)) {
    lockfileKind = 'pnpm';
    parsed = parsePnpmLock(fs.readFileSync(pnpmLockPath, 'utf8'), opts);
  } else if (fs.existsSync(yarnLockPath)) {
    const contents = fs.readFileSync(yarnLockPath, 'utf8');
    const devNames = Object.keys(manifest.devDependencies ?? {});
    // yarn.lock has no root entry of its own — root's declared ranges come
    // straight from package.json, exactly as read here (see Task 4's note
    // on why this must be a real parameter, not reconstructed from blocks).
    const rootDependencyRanges = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
    if (detectYarnLockFormat(contents) === 'berry') {
      lockfileKind = 'yarn-berry';
      parsed = parseYarnBerryLock(contents, opts, rootDependencyRanges, devNames);
    } else {
      lockfileKind = 'yarn-classic';
      parsed = parseYarnClassicLock(contents, opts, rootDependencyRanges, devNames);
    }
  } else if (fs.existsSync(path.join(projectPath, 'node_modules'))) {
    parsed = nodeModulesWalkFallback(projectPath, manifest, opts);
  } else {
    parsed = declaredDepsOnlyFallback(manifest, opts);
  }

  warnings.push(...parsed.warnings);

  const { kept, excludedCount } = filterByDiskPresence(projectPath, parsed.packages);
  if (excludedCount > 0) {
    warnings.push(`${excludedCount} optional/peer dependenc${excludedCount === 1 ? 'y was' : 'ies were'} declared in the lockfile but not installed on disk (excluded from the report).`);
  }

  return {
    projectName: manifest.name ?? path.basename(projectPath),
    projectVersion: manifest.version,
    ecosystems: ['npm'],
    lockfile: lockfileKind,
    packages: toScannedPackages(projectPath, kept),
    warnings,
    projectLicenseRaw: typeof manifest.license === 'string' ? manifest.license : undefined,
  };
}

export const npmEcosystem: Ecosystem = { id: 'npm', detect, scan };
