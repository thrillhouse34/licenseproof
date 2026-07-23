"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUvLock = parseUvLock;
const smol_toml_1 = require("smol-toml");
const dependencyGraph_1 = require("../dependencyGraph");
const pypi_1 = require("../pypi");
/**
 * Pure parser for `uv.lock` (astral-sh/uv's lockfile). Takes the raw lockfile
 * string + `ScanOptions`; produces `InternalPyPiPackage[]` (before diskPath
 * resolution) and warnings. The orchestrator (`pypi.ts`) adds diskPath by
 * reusing `buildSitePackagesResolver` — this parser never touches `fs`.
 *
 * Structure (confirmed against real pallets/flask + astral-sh/ruff uv.lock
 * files):
 *   - The lockfile is TOML with a top-level `[[package]]` array. smol-toml
 *     surfaces it as `doc.package: object[]`.
 *   - The ROOT project entry is identified by `source = { editable = "." }`
 *     (a real, distributable package) or `source = { virtual = "." }` (a
 *     non-distributable project) — NOT by matching the project name against a
 *     package entry (names can theoretically collide).
 *   - The root entry's `dependencies` array = production root edges.
 *   - The root entry's `[package.dev-dependencies]` sub-table (a map of group
 *     name -> array of `{ name, ... }`) = every dev/test/docs/etc. group. All
 *     of them collapse to `dev: true` — the existing contract carries only a
 *     boolean, no named groups.
 *   - Every OTHER (non-root) `[[package]]` entry's `dependencies` array
 *     (`[{ name, marker? }]`) = its own outgoing edges, resolved by name
 *     against the set of all package entries.
 *
 * Marker-based multi-version splits (CONFIRMED real, not hypothetical): a name
 * can appear in more than one `[[package]]` block when a platform/Python-version
 * marker forces different resolved versions (e.g. `sphinx` appears twice in a
 * real flask `uv.lock` for py<3.11 vs. py>=3.11). This parser collapses to the
 * FIRST-encountered version as canonical and emits ONE scan-level warning naming
 * the affected package(s) — a disclosed, documented simplification, never a
 * silent arbitrary pick (same treatment as the pnpm peer-suffix gap from M2).
 *
 * `licenseRaw` is intentionally left `undefined`: uv.lock `[[package]]` entries
 * carry NO license field at all (confirmed against the real fetched files). The
 * actual per-package license is resolved later from the installed package's
 * `METADATA` file (via `diskPath`) in the resolution pipeline (a future task) —
 * do not go looking for a `licenseRaw`-from-uv.lock field; it does not exist.
 */
// A sentinel graph root key. No real PEP 503 normalized package name is the
// empty string, so it can never collide with a genuine package.
const ROOT_KEY = '';
/** True if a package's `source` marks it as the root project (`.`). */
function isRootSource(source) {
    if (source === null || typeof source !== 'object' || Array.isArray(source))
        return false;
    const s = source;
    return s.editable === '.' || s.virtual === '.';
}
/**
 * Extract normalized dependency names from a `dependencies = [{ name, marker? }]`
 * inline-array-of-tables value (also used for each `[package.dev-dependencies]`
 * group's array). Non-object / nameless entries are skipped defensively.
 */
function depNamesFromArray(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const n = item.name;
            if (typeof n === 'string')
                out.push((0, pypi_1.normalizePypiName)(n));
        }
    }
    return out;
}
function parseUvLock(contents, opts) {
    const warnings = [];
    let doc;
    try {
        doc = (0, smol_toml_1.parse)(contents);
    }
    catch {
        return {
            packages: [],
            warnings: ['uv.lock could not be parsed as TOML; reporting no packages.'],
        };
    }
    const rawPackages = Array.isArray(doc.package)
        ? doc.package
        : [];
    // Identify the root project entry by its `source`, and set every other entry
    // aside as a real dependency package.
    let rootEntry;
    const nonRoot = [];
    for (const entry of rawPackages) {
        if (!rootEntry && isRootSource(entry.source)) {
            rootEntry = entry;
        }
        else {
            nonRoot.push(entry);
        }
    }
    if (!rootEntry) {
        warnings.push('uv.lock has no root project entry (no package with source = { editable = "." } or { virtual = "." }); cannot determine production vs. dev dependencies. Reporting no packages.');
        return { packages: [], warnings };
    }
    // Build the canonical name -> package lookup. First-encountered version wins
    // on a marker-based multi-version collapse; affected names are recorded so we
    // can disclose the simplification in a single warning.
    const byName = new Map();
    const collapsedNames = new Set();
    for (const entry of nonRoot) {
        const name = typeof entry.name === 'string' ? entry.name : undefined;
        if (!name)
            continue;
        const norm = (0, pypi_1.normalizePypiName)(name);
        if (byName.has(norm)) {
            // A second (or later) block for the same name — a marker split. Keep the
            // first-listed version; record the canonical name for the disclosure.
            collapsedNames.add(byName.get(norm).name);
            continue;
        }
        const version = typeof entry.version === 'string' ? entry.version : '';
        byName.set(norm, { name, version, deps: depNamesFromArray(entry.dependencies) });
    }
    // Root edges: production from `dependencies`, dev from every
    // `[package.dev-dependencies]` group (all groups -> dev: true).
    const rootProdNames = depNamesFromArray(rootEntry.dependencies);
    const rootDevNames = [];
    const devTable = rootEntry['dev-dependencies'];
    if (devTable && typeof devTable === 'object' && !Array.isArray(devTable)) {
        for (const groupDeps of Object.values(devTable)) {
            rootDevNames.push(...depNamesFromArray(groupDeps));
        }
    }
    // buildPaths' rootDependencies is Record<name, rangeOrVersion>; PyPI edges
    // resolve purely by name, so the value is an unused placeholder.
    const rootProdDeps = {};
    for (const n of rootProdNames)
        rootProdDeps[n] = '';
    const rootAllDeps = { ...rootProdDeps };
    for (const n of rootDevNames)
        if (!(n in rootAllDeps))
            rootAllDeps[n] = '';
    const getNode = (key) => {
        const pkg = byName.get(key);
        if (!pkg)
            return undefined;
        const dependencies = {};
        for (const d of pkg.deps)
            dependencies[d] = '';
        return { key, dependencies };
    };
    const resolveEdge = (_from, depName) => byName.has(depName) ? depName : undefined;
    const nameForKey = (key) => byName.get(key)?.name ?? key;
    // Two passes, exactly like the yarn parser's dev-detection: reachable from the
    // production roots only, vs. reachable from production + every dev group. A
    // package reachable from production is `dev: false` even if a dev dep also
    // reaches it (matches npm's "also needed by production" semantics).
    const prodOnlyPaths = (0, dependencyGraph_1.buildPaths)({
        rootKey: ROOT_KEY,
        rootDependencies: rootProdDeps,
        getNode,
        resolveEdge,
        nameForKey,
    });
    const allPaths = (0, dependencyGraph_1.buildPaths)({
        rootKey: ROOT_KEY,
        rootDependencies: rootAllDeps,
        getNode,
        resolveEdge,
        nameForKey,
    });
    // `direct` = literally named in the root's own production or dev dep lists
    // (top-level declared), matching npm's `direct` semantics.
    const directNames = new Set();
    for (const n of [...rootProdNames, ...rootDevNames]) {
        if (byName.has(n))
            directNames.add(n);
    }
    const packages = [];
    for (const [norm, pkg] of byName) {
        const pathInfo = allPaths.get(norm);
        // Not reachable from any production or dev root — an orphan entry (e.g. only
        // referenced by a root optional-extra we don't treat as installed). Skip it,
        // matching the yarn parser's `if (!pathInfo) continue`.
        if (!pathInfo)
            continue;
        const dev = !prodOnlyPaths.has(norm);
        if (opts.productionOnly && dev)
            continue;
        packages.push({
            name: pkg.name,
            version: pkg.version,
            direct: directNames.has(norm),
            dev,
            paths: pathInfo.examples,
            pathCountAtLeast: pathInfo.pathCountAtLeast,
            // See the file-header note: uv.lock carries no license field, resolved
            // later from installed METADATA.
            licenseRaw: undefined,
            installPath: (0, pypi_1.expectedDistInfoName)(pkg.name, pkg.version),
        });
    }
    if (collapsedNames.size > 0) {
        const names = [...collapsedNames].sort();
        const shown = names.slice(0, 5).join(', ');
        const more = names.length > 5 ? `, and ${names.length - 5} more` : '';
        warnings.push(`uv.lock lists ${names.length} package name${names.length === 1 ? '' : 's'} in more than one [[package]] block due to environment-marker splits (platform/Python-version conditional versions): ${shown}${more}. Collapsed each to its first-listed version for reporting — the version actually resolved on a specific platform may differ.`);
    }
    return { packages, warnings };
}
//# sourceMappingURL=uvLockParser.js.map