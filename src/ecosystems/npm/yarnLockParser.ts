import * as YAML from 'yaml';
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

export function detectYarnLockFormat(contents: string): 'classic' | 'berry' {
  return contents.includes('__metadata:') ? 'berry' : 'classic';
}

interface LockBlock {
  descriptors: string[]; // e.g. ["express@^4.18.0"] or ["express@npm:^4.18.0"]
  name: string;
  version: string;
  dependencies: Record<string, string>; // depName -> range, as declared in this block
}

function nameFromDescriptor(descriptor: string): string {
  const cleaned = descriptor.replace(/^npm:/, '');
  const lastAt = cleaned.lastIndexOf('@');
  return lastAt > 0 ? cleaned.slice(0, lastAt) : cleaned;
}

function findBlockByDescriptor(blocks: LockBlock[], depName: string, depRange: string, prefix: '' | 'npm:'): LockBlock | undefined {
  const target = `${depName}@${prefix}${depRange}`;
  return blocks.find((b) => b.descriptors.includes(target));
}

function buildGraphAndPackages(
  rootBlock: LockBlock,
  blocks: LockBlock[],
  rootDeps: Record<string, string>,
  descriptorPrefix: '' | 'npm:',
  opts: { productionOnly: boolean },
  rootDevDependencyNames: string[],
): ParsedLockfileResult {
  // rootBlock is a freshly-allocated sentinel object, distinct from every
  // real block by identity (LockBlock keys are compared by reference, not
  // value) — it can never collide with a real dependency block, unlike a
  // string sentinel that would need to avoid colliding with real names.
  const getNode = (block: LockBlock) => ({ key: block, dependencies: block.dependencies });
  const resolveEdge = (_from: LockBlock, depName: string, depRange: string) => findBlockByDescriptor(blocks, depName, depRange, descriptorPrefix);
  const nameForKey = (block: LockBlock) => block.name;

  const rootProdDeps: Record<string, string> = {};
  const rootDevDeps: Record<string, string> = {};
  for (const [name, range] of Object.entries(rootDeps)) {
    if (rootDevDependencyNames.includes(name)) rootDevDeps[name] = range;
    else rootProdDeps[name] = range;
  }

  const prodOnlyPaths = buildPaths<LockBlock>({ rootKey: rootBlock, rootDependencies: rootProdDeps, getNode, resolveEdge, nameForKey });
  const allPaths = buildPaths<LockBlock>({ rootKey: rootBlock, rootDependencies: rootDeps, getNode, resolveEdge, nameForKey });

  const directBlocks = new Set<LockBlock>();
  for (const [name, range] of Object.entries(rootDeps)) {
    const block = findBlockByDescriptor(blocks, name, range, descriptorPrefix);
    if (block) directBlocks.add(block);
  }

  const packages: ParsedPackage[] = [];
  for (const block of blocks) {
    const pathInfo = allPaths.get(block);
    if (!pathInfo) continue;
    const isDev = !prodOnlyPaths.has(block);
    if (opts.productionOnly && isDev) continue;
    packages.push({
      name: block.name,
      version: block.version,
      direct: directBlocks.has(block),
      dev: isDev,
      optional: false,
      peer: false,
      paths: pathInfo.examples,
      pathCountAtLeast: pathInfo.pathCountAtLeast,
      licenseRaw: undefined,
      installPaths: [`node_modules/${block.name}`],
    });
  }
  return { packages, warnings: [] };
}

export function parseYarnClassicLock(
  contents: string,
  opts: { productionOnly: boolean },
  rootDependencyRanges: Record<string, string>,
  rootDevDependencyNames: string[],
): ParsedLockfileResult {
  const blocks: LockBlock[] = [];
  const lines = contents.split('\n');
  let currentDescriptors: string[] = [];
  let currentVersion = '';
  let currentDeps: Record<string, string> = {};
  let inDependenciesBlock = false;

  const flush = () => {
    if (currentDescriptors.length > 0 && currentVersion) {
      blocks.push({ descriptors: currentDescriptors, name: nameFromDescriptor(currentDescriptors[0]), version: currentVersion, dependencies: currentDeps });
    }
    currentDescriptors = [];
    currentVersion = '';
    currentDeps = {};
    inDependenciesBlock = false;
  };

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ') && line.trim().endsWith(':')) {
      flush();
      currentDescriptors = line.trim().replace(/:$/, '').split(',').map((d) => d.trim().replace(/^"|"$/g, ''));
      continue;
    }
    const versionMatch = line.match(/^\s{2}version\s+"?([^"\s]+)"?/);
    if (versionMatch) {
      currentVersion = versionMatch[1];
      inDependenciesBlock = false;
      continue;
    }
    if (/^\s{2}(dependencies|optionalDependencies):\s*$/.test(line)) {
      inDependenciesBlock = true;
      continue;
    }
    if (inDependenciesBlock) {
      const depMatch = line.match(/^\s{4}("?[^"\s]+"?)\s+"?([^"\s]+)"?/);
      if (depMatch) {
        const depName = depMatch[1].replace(/^"|"$/g, '');
        const depRange = depMatch[2];
        currentDeps[depName] = depRange;
        continue;
      }
      inDependenciesBlock = false;
    }
  }
  flush();

  // Synthesize a root block so buildPaths has a rootKey to start from —
  // never added to `blocks`, so it can't be found by findBlockByDescriptor
  // and can't be mistaken for a real dependency.
  const rootBlock: LockBlock = { descriptors: [], name: '', version: '', dependencies: {} };
  return buildGraphAndPackages(rootBlock, blocks, rootDependencyRanges, '', opts, rootDevDependencyNames);
}

export function parseYarnBerryLock(
  contents: string,
  opts: { productionOnly: boolean },
  rootDependencyRanges: Record<string, string>,
  rootDevDependencyNames: string[],
): ParsedLockfileResult {
  const doc = YAML.parse(contents) as Record<string, any>;
  const blocks: LockBlock[] = [];
  for (const [key, entry] of Object.entries(doc)) {
    if (key === '__metadata') continue;
    const descriptors = key.split(',').map((d) => d.trim().replace(/^"|"$/g, ''));
    const deps: Record<string, string> = {};
    const allDeclaredDeps = { ...((entry as any).dependencies ?? {}), ...((entry as any).optionalDependencies ?? {}) };
    for (const [depName, depRangeWithPrefix] of Object.entries(allDeclaredDeps)) {
      deps[depName] = String(depRangeWithPrefix).replace(/^npm:/, '');
    }
    blocks.push({ descriptors, name: nameFromDescriptor(descriptors[0]), version: (entry as any).version, dependencies: deps });
  }
  // Same synthetic-root pattern as parseYarnClassicLock — a fresh sentinel
  // object never added to `blocks`, so it's never mistaken for a real block.
  const rootBlock: LockBlock = { descriptors: [], name: '', version: '', dependencies: {} };
  return buildGraphAndPackages(rootBlock, blocks, rootDependencyRanges, 'npm:', opts, rootDevDependencyNames);
}
