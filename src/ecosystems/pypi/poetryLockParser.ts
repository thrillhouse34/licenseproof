import { parse as parseToml } from 'smol-toml';
import { buildPaths } from '../dependencyGraph';
import type { ScanOptions } from '../types';
import type { ParsedPyproject } from './pyprojectTomlParser';
import {
  expectedDistInfoName,
  normalizePypiName,
  type InternalPyPiPackage,
  type PyPiParseResult,
} from '../pypi';

/**
 * Pure parser for a Poetry `poetry.lock`. Takes the raw lockfile string, the
 * already-parsed `pyproject.toml` group info (from `parsePyprojectToml` — do NOT
 * re-parse pyproject.toml here), and `ScanOptions`. Produces the same
 * `InternalPyPiPackage[]` shape every PyPI parser produces; diskPath resolution
 * is done later by the orchestrator, not here.
 *
 * Why pyproject.toml is required as an input: `poetry.lock` carries NO per-package
 * group field of any kind. Group membership (main/production vs. dev vs. any other
 * named group) can only be recovered by cross-referencing which top-level names
 * `pyproject.toml` declares as main deps vs. group deps, then computing graph
 * reachability from each root set — exactly the shape of problem npm's parsers
 * already solve with the shared dependency graph.
 */

/**
 * A package entry as read from a `[[package]]` block, with its dependency edges
 * already resolved to the normalized keys of packages that actually exist in this
 * lock (unresolvable edge names — e.g. a dependency only present under an extra,
 * or a platform-specific dep pruned from the lock — are dropped, matching npm's
 * "resolve by name, ignore edges that don't land on a real block" behavior).
 */
interface PoetryPackage {
  /** Display name exactly as it appears in the lockfile. */
  name: string;
  version: string;
  /** Normalized dependency keys -> "" (ranges are irrelevant: poetry resolves one version per name). */
  deps: Record<string, string>;
}

/**
 * Sentinel root key for `buildPaths`. A PEP 503 normalized project name can never
 * be the empty string (names must start with an alphanumeric), so `''` can never
 * collide with a real package key. `buildPaths` sets then deletes the root entry
 * internally and never passes it to `getNode`/`nameForKey`, so an empty display
 * name is never emitted.
 */
const ROOT_KEY = '';

export function parsePoetryLock(
  contents: string,
  pyproject: ParsedPyproject,
  opts: ScanOptions,
): PyPiParseResult {
  const warnings: string[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = parseToml(contents) as Record<string, unknown>;
  } catch {
    return {
      packages: [],
      warnings: ['poetry.lock could not be parsed as TOML — no packages reported from it.'],
    };
  }

  const rawPackages = Array.isArray(doc.package)
    ? (doc.package as Record<string, unknown>[])
    : [];

  // --- Pass 1: index every [[package]] by its normalized name. ---
  // `rawDepNames` is kept separate so edges are only resolved AFTER every
  // package is known (a dependency can appear before its own [[package]] block).
  const byNorm = new Map<string, PoetryPackage>();
  const rawDepNames = new Map<string, string[]>();

  for (const entry of rawPackages) {
    const name = typeof entry.name === 'string' ? entry.name : undefined;
    const version = typeof entry.version === 'string' ? entry.version : undefined;
    if (!name || !version) continue;
    const norm = normalizePypiName(name);
    // First-wins on the rare duplicate-name case (marker-split constraints can
    // theoretically list a name twice — poetry normally resolves exactly one
    // version per name, so this is defensive, not the common path).
    if (byNorm.has(norm)) continue;

    // `[package.dependencies]` is a TABLE keyed by dependency name. Each VALUE
    // may be one of three shapes, all confirmed against real poetry.lock files:
    //   - a plain string constraint:            colorama = "*"
    //   - an inline table:                       colorama = {version = "*", markers = "...", optional = true}
    //   - an array of inline tables (marker splits): importlib-metadata = [{version = "...", markers = "..."}]
    // We only ever need the KEY (the dependency name) as the graph edge target,
    // never the constraint value — so reading Object.keys() handles all three
    // shapes uniformly and the value shape is irrelevant to us.
    const depsTable = entry.dependencies;
    const depNames =
      depsTable !== null && typeof depsTable === 'object' && !Array.isArray(depsTable)
        ? Object.keys(depsTable as Record<string, unknown>)
        : [];

    byNorm.set(norm, { name, version, deps: {} });
    rawDepNames.set(norm, depNames);
  }

  // --- Pass 2: resolve each package's edges to normalized keys that exist. ---
  for (const [norm, depNames] of rawDepNames) {
    const pkg = byNorm.get(norm)!;
    for (const depName of depNames) {
      const depNorm = normalizePypiName(depName);
      // Ignore self-edges and edges to names not present as their own [[package]].
      if (depNorm !== norm && byNorm.has(depNorm)) {
        pkg.deps[depNorm] = '';
      }
    }
  }

  // --- Root edges from pyproject.toml: main deps vs. every other group. ---
  const mainNorms = pyproject.mainDeps.map(normalizePypiName);
  const groupNorms = Object.values(pyproject.groupDeps).flat().map(normalizePypiName);
  const allRootNorms = [...new Set([...mainNorms, ...groupNorms])];

  // `direct` = literally declared at the top level of pyproject.toml (main OR any
  // group), matching npm's `direct` semantics ("explicitly listed in the project's
  // own dependency lists", NOT "one hop from root in the resolved graph"). These
  // usually coincide but the declared-name test is the authoritative one.
  const directNorms = new Set(allRootNorms);

  // Root dependency record for buildPaths: the union of main + every group's
  // declared names that actually resolve to a package in this lock.
  const rootDependencies: Record<string, string> = {};
  for (const n of allRootNorms) {
    if (byNorm.has(n)) rootDependencies[n] = '';
  }

  // Defensive fallback: if pyproject.toml declared nothing that matches any lock
  // package (e.g. an unparseable/absent pyproject, or a name-form mismatch), we
  // would otherwise emit ZERO packages despite a populated lock — a silent data
  // loss. Instead report every lock package flatly (dev=false, one trivial path)
  // and warn, so nothing is dropped silently.
  if (Object.keys(rootDependencies).length === 0 && byNorm.size > 0) {
    warnings.push(
      'poetry.lock lists packages but none of pyproject.toml\'s declared dependencies could be cross-referenced against them (missing or unrecognized pyproject.toml dependency tables). Reporting all locked packages without dependency-chain or dev/production classification.',
    );
    // Nothing is classified as dev in this fallback, so `productionOnly` keeps
    // everything — there is no dev flag to filter on.
    const packages: InternalPyPiPackage[] = [];
    for (const pkg of byNorm.values()) {
      packages.push({
        name: pkg.name,
        version: pkg.version,
        direct: true,
        dev: false,
        paths: [[pkg.name]],
        pathCountAtLeast: 1,
        licenseRaw: undefined,
        installPath: expectedDistInfoName(pkg.name, pkg.version),
      });
    }
    return { packages, warnings };
  }

  // --- "Reachable from production" set via plain graph traversal. ---
  // This is a set-membership question (is a package reachable from a main dep?),
  // NOT a path-counting one, so a plain DFS is used here rather than buildPaths
  // (which does the heavier example/count/back-edge work we don't need for the
  // dev flag). A package is dev iff it is NOT reachable from any main dep — even
  // if it is ALSO reachable from a dev-only group, being reachable from
  // production makes dev=false, matching npm's semantics for a package that is
  // both a prod and a dev dependency.
  const prodReachable = new Set<string>();
  const stack = mainNorms.filter((n) => byNorm.has(n));
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (prodReachable.has(cur)) continue;
    prodReachable.add(cur);
    for (const dep of Object.keys(byNorm.get(cur)!.deps)) {
      if (!prodReachable.has(dep)) stack.push(dep);
    }
  }

  // --- Path examples/counts: buildPaths ONCE over ALL edges (main + groups). ---
  // Every package reachable from ANY root gets real example chains and a count,
  // regardless of which root reached it first. `dev` (above) and `paths` (here)
  // are computed independently: a package needed by both a prod dep and a
  // dev-only dep is dev=false but its `paths` still reflect real chains from
  // wherever they originate.
  const allPaths = buildPaths<string>({
    rootKey: ROOT_KEY,
    rootDependencies,
    getNode: (key) => {
      const pkg = byNorm.get(key);
      return pkg ? { key, dependencies: pkg.deps } : undefined;
    },
    // Edge names are already normalized keys (both pkg.deps keys and
    // rootDependencies keys are normalized), so resolution is a direct lookup.
    resolveEdge: (_from, depName) => (byNorm.has(depName) ? depName : undefined),
    nameForKey: (key) => byNorm.get(key)?.name ?? key,
  });

  const packages: InternalPyPiPackage[] = [];
  for (const [norm, pkg] of byNorm) {
    const pathInfo = allPaths.get(norm);
    // Not reachable from any declared root — a stale/orphan lock entry. Skip it,
    // matching yarn's `if (!pathInfo) continue;` behavior.
    if (!pathInfo) continue;

    const dev = !prodReachable.has(norm);
    if (opts.productionOnly && dev) continue;

    packages.push({
      name: pkg.name,
      version: pkg.version,
      direct: directNorms.has(norm),
      dev,
      paths: pathInfo.examples,
      pathCountAtLeast: pathInfo.pathCountAtLeast,
      // poetry.lock's [[package]] entries carry NO license field at all — the
      // complete field set is description / optional / python-versions / files /
      // [package.dependencies] / [package.extras]. `licenseRaw` is therefore
      // intentionally left undefined at the parser level: the real per-package
      // license only becomes available later, when the resolution pipeline reads
      // the installed package's own dist-info METADATA via diskPath (Milestone 4
      // Task 6). This is NOT a poetry-specific gap to work around — the lockfile
      // format was simply never designed to carry license data (unlike npm's
      // package-lock.json, which does embed each package's `license`). A future
      // reader must not go looking for a license field in poetry.lock; it does
      // not exist.
      licenseRaw: undefined,
      installPath: expectedDistInfoName(pkg.name, pkg.version),
    });
  }

  return { packages, warnings };
}
