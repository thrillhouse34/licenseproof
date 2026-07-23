import { buildPaths } from '../dependencyGraph';

export interface ParsedPackage {
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

export interface ParsedLockfileResult {
  packages: ParsedPackage[];
  warnings: string[];
}

interface PackageLockEntry {
  version?: string;
  license?: string;
  licenses?: Array<{ type: string }>;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLockFile {
  packages?: Record<string, PackageLockEntry>;
}

function keyToName(key: string): string {
  const segments = key.split('node_modules/').filter(Boolean).map((s) => s.replace(/\/$/, ''));
  return segments[segments.length - 1] ?? key;
}

function resolveEdge(fromKey: string, depName: string, packagesMap: Map<string, PackageLockEntry>): string | undefined {
  const segments = fromKey === '' ? [] : fromKey.split('node_modules/').filter(Boolean).map((s) => s.replace(/\/$/, ''));
  for (let i = segments.length; i >= 0; i--) {
    const prefix = segments.slice(0, i).map((s) => `node_modules/${s}`).join('/');
    const candidateKey = prefix ? `${prefix}/node_modules/${depName}` : `node_modules/${depName}`;
    if (packagesMap.has(candidateKey)) return candidateKey;
  }
  return undefined;
}

export function parsePackageLock(contents: string, opts: { productionOnly: boolean }): ParsedLockfileResult {
  const lockfile = JSON.parse(contents) as PackageLockFile;
  const entries = lockfile.packages ?? {};
  const packagesMap = new Map(Object.entries(entries));

  const rootEntry = packagesMap.get('') ?? {};
  const rootDeps = { ...(rootEntry.dependencies ?? {}), ...(rootEntry.devDependencies ?? {}), ...(rootEntry.optionalDependencies ?? {}) };

  const pathsByKey = buildPaths<string>({
    rootKey: '',
    rootDependencies: rootDeps,
    getNode: (key) => {
      const entry = packagesMap.get(key);
      if (!entry) return undefined;
      const dependencies = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}), ...(entry.peerDependencies ?? {}) };
      return { key, dependencies };
    },
    resolveEdge: (fromKey, depName, _depRange) => resolveEdge(fromKey, depName, packagesMap),
    nameForKey: keyToName,
  });

  const directKeys = new Set<string>();
  for (const depName of Object.keys(rootDeps)) {
    const resolved = resolveEdge('', depName, packagesMap);
    if (resolved) directKeys.add(resolved);
  }

  const packages: ParsedPackage[] = [];
  for (const [key, entry] of packagesMap) {
    if (key === '') continue;
    const pathInfo = pathsByKey.get(key);
    if (!pathInfo) continue; // not reachable from root's declared dependencies
    if (opts.productionOnly && entry.dev) continue;

    let licenseRaw = entry.license;
    if (!licenseRaw && entry.licenses && entry.licenses.length > 0) {
      licenseRaw = entry.licenses.map((l) => l.type).join(' OR ');
    }

    packages.push({
      name: keyToName(key),
      version: entry.version ?? 'unknown',
      direct: directKeys.has(key),
      dev: !!entry.dev,
      optional: !!entry.optional,
      peer: !!entry.peer,
      paths: pathInfo.examples,
      pathCountAtLeast: pathInfo.pathCountAtLeast,
      licenseRaw,
      installPaths: [key],
    });
  }

  return { packages, warnings: [] };
}
