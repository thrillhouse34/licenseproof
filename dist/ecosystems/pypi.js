"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pypiEcosystem = void 0;
exports.normalizePypiName = normalizePypiName;
exports.expectedDistInfoName = expectedDistInfoName;
exports.buildSitePackagesResolver = buildSitePackagesResolver;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const smol_toml_1 = require("smol-toml");
const requirementsTxtParser_1 = require("./pypi/requirementsTxtParser");
const pyprojectTomlParser_1 = require("./pypi/pyprojectTomlParser");
const poetryLockParser_1 = require("./pypi/poetryLockParser");
const uvLockParser_1 = require("./pypi/uvLockParser");
// ---------------------------------------------------------------------------
// PEP 503 normalization + installPath computation (shared, pure helpers)
// ---------------------------------------------------------------------------
/** PEP 503 normalized project name: lowercase, runs of `-_.` collapse to `-`. */
function normalizePypiName(name) {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
}
/**
 * The EXPECTED `.dist-info` directory name for a package, using the PEP 503
 * normalized name with `-` replaced by `_` (the on-disk dist-info convention
 * uses underscores). This is the declared `installPath` — computed purely, never
 * fs-verified. Example: name "typing-extensions", version "4.9.0" ->
 * "typing_extensions-4.9.0.dist-info".
 */
function expectedDistInfoName(name, version) {
    const normalized = normalizePypiName(name).replace(/-/g, '_');
    return `${normalized}-${version}.dist-info`;
}
/**
 * Locate the site-packages directory under a venv, returning its path RELATIVE
 * to projectPath, or undefined if none found. Checks the Unix layout
 * (`<venv>/lib/python3.X/site-packages`) first, then the Windows layout
 * (`<venv>/Lib/site-packages`).
 */
function findSitePackagesDir(projectPath, venvName) {
    const libDir = path.join(projectPath, venvName, 'lib');
    if (fs.existsSync(libDir)) {
        let entries = [];
        try {
            entries = fs.readdirSync(libDir, { withFileTypes: true });
        }
        catch {
            entries = [];
        }
        // Sorted so the choice is deterministic if (unusually) multiple pythonX.Y
        // dirs exist in one venv.
        const pyDirs = entries
            .filter((e) => e.isDirectory() && /^python3\.\d+/.test(e.name))
            .map((e) => e.name)
            .sort();
        for (const py of pyDirs) {
            const sp = path.join(projectPath, venvName, 'lib', py, 'site-packages');
            if (fs.existsSync(sp)) {
                return path.join(venvName, 'lib', py, 'site-packages');
            }
        }
    }
    // Windows-style layout (exact casing).
    const winSp = path.join(projectPath, venvName, 'Lib', 'site-packages');
    if (fs.existsSync(winSp)) {
        return path.join(venvName, 'Lib', 'site-packages');
    }
    return undefined;
}
/**
 * Build the shared site-packages resolver for a project. Detects `.venv/` then
 * `venv/`; if neither yields a site-packages directory, returns a resolver whose
 * `resolve()` always returns undefined (graceful degradation — diskPath
 * undefined for everything, exactly like npm's missing-node_modules case).
 */
function buildSitePackagesResolver(projectPath) {
    let sitePackagesDir;
    for (const venvName of ['.venv', 'venv']) {
        const found = findSitePackagesDir(projectPath, venvName);
        if (found) {
            sitePackagesDir = found;
            break;
        }
    }
    if (!sitePackagesDir) {
        return { sitePackagesDir: undefined, resolve: () => undefined };
    }
    // List site-packages ONCE and build a normalized-name -> dist-info-dir lookup.
    // PEP 503 normalization is load-bearing: a package named `typing-extensions`
    // installs a directory named `typing_extensions-4.9.0.dist-info` (underscore).
    const lookup = new Map();
    const spAbs = path.join(projectPath, sitePackagesDir);
    let entries = [];
    try {
        entries = fs.readdirSync(spAbs, { withFileTypes: true });
    }
    catch {
        entries = [];
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (!/\.(?:dist-info|egg-info)$/.test(entry.name))
            continue;
        // A dist-info directory is named `<name>-<version>.dist-info`. The package
        // name is everything before the LAST hyphen (a normalized dist-info name
        // uses underscores internally, so the version is the only `-`-delimited
        // trailing token). PEP 503 normalization then folds `_`/`.`/`-` together.
        const distInfoName = entry.name.replace(/\.(?:dist-info|egg-info)$/, '');
        const lastDash = distInfoName.lastIndexOf('-');
        if (lastDash <= 0)
            continue;
        const rawName = distInfoName.slice(0, lastDash);
        const normalized = normalizePypiName(rawName);
        if (!lookup.has(normalized)) {
            lookup.set(normalized, path.join(sitePackagesDir, entry.name));
        }
    }
    return {
        sitePackagesDir,
        resolve(name) {
            return lookup.get(normalizePypiName(name));
        },
    };
}
// ---------------------------------------------------------------------------
// Fallback tier: pyproject.toml declared-only
// ---------------------------------------------------------------------------
function declaredOnlyFromPyproject(contents, opts) {
    const { mainDeps, groupDeps } = (0, pyprojectTomlParser_1.parsePyprojectToml)(contents);
    const packages = [];
    const add = (name, dev) => {
        if (dev && opts.productionOnly)
            return;
        packages.push({
            name,
            version: 'unresolved (no lockfile)',
            direct: true,
            dev,
            paths: [[name]],
            pathCountAtLeast: 1,
            // No version known, so no meaningful dist-info name can be computed. Use
            // the normalized name alone as the logical install path placeholder.
            installPath: normalizePypiName(name),
        });
    };
    for (const name of mainDeps)
        add(name, false);
    for (const names of Object.values(groupDeps)) {
        for (const name of names)
            add(name, true);
    }
    return {
        packages,
        warnings: [
            'No poetry.lock, uv.lock, or requirements.txt found. Reporting declared top-level dependencies only from pyproject.toml — the transitive tree is incomplete and versions are unresolved.',
        ],
    };
}
// ---------------------------------------------------------------------------
// Fallback tier: requirements.txt pinned
// ---------------------------------------------------------------------------
function fromRequirementsTxt(contents) {
    const { pinned, unresolvable } = (0, requirementsTxtParser_1.parseRequirementsTxt)(contents);
    const packages = pinned.map((p) => ({
        name: p.name,
        version: p.version,
        direct: true,
        dev: false,
        paths: [[p.name]],
        pathCountAtLeast: 1,
        installPath: expectedDistInfoName(p.name, p.version),
    }));
    const warnings = [
        'requirements.txt has no transitive dependency information — reporting only the pinned packages listed directly. The true installed tree may be larger.',
    ];
    if (unresolvable.length > 0) {
        const names = unresolvable
            .map((u) => u.name ?? u.raw)
            .slice(0, 5)
            .join(', ');
        const more = unresolvable.length > 5 ? `, and ${unresolvable.length - 5} more` : '';
        warnings.push(`${unresolvable.length} requirement${unresolvable.length === 1 ? '' : 's'} in requirements.txt ${unresolvable.length === 1 ? 'is' : 'are'} not pinned as name==version (git/URL/local-path installs or unpinned ranges) and cannot be resolved from the lockfile: ${names}${more}.`);
    }
    return { packages, warnings };
}
// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
function detect(projectPath) {
    return (fs.existsSync(path.join(projectPath, 'pyproject.toml')) ||
        fs.existsSync(path.join(projectPath, 'requirements.txt')) ||
        fs.existsSync(path.join(projectPath, 'poetry.lock')) ||
        fs.existsSync(path.join(projectPath, 'uv.lock')));
}
function toScannedPackages(packages, resolver) {
    return packages.map((p) => ({
        name: p.name,
        version: p.version,
        ecosystem: 'pypi',
        direct: p.direct,
        dev: p.dev,
        paths: p.paths,
        pathCountAtLeast: p.pathCountAtLeast,
        licenseRaw: p.licenseRaw,
        installPath: p.installPath,
        diskPath: resolver.resolve(p.name),
    }));
}
async function scan(projectPath, opts) {
    const warnings = [];
    const uvLockPath = path.join(projectPath, 'uv.lock');
    const poetryLockPath = path.join(projectPath, 'poetry.lock');
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    // Site-packages resolver is shared across every tier — built once.
    const resolver = buildSitePackagesResolver(projectPath);
    let parsed;
    let lockfile;
    // Precedence: uv.lock > poetry.lock > requirements.txt (pinned) > pyproject.toml.
    if (fs.existsSync(uvLockPath)) {
        // uv.lock is fully self-contained (root project entry carries its own
        // production + dev-dependency edges), so — unlike poetry.lock — it needs no
        // pyproject.toml cross-reference to classify dev vs. production.
        parsed = (0, uvLockParser_1.parseUvLock)(fs.readFileSync(uvLockPath, 'utf8'), opts);
        lockfile = 'uv-lock';
    }
    else if (fs.existsSync(poetryLockPath)) {
        // poetry.lock carries no per-package group field, so the poetry parser needs
        // pyproject.toml's declared main-vs-group split to classify dev/production
        // and `direct`. Pass an empty pyproject when (unusually) none exists — the
        // parser degrades gracefully with a warning rather than dropping packages.
        const pyproject = (0, pyprojectTomlParser_1.parsePyprojectToml)(fs.existsSync(pyprojectPath) ? fs.readFileSync(pyprojectPath, 'utf8') : '');
        parsed = (0, poetryLockParser_1.parsePoetryLock)(fs.readFileSync(poetryLockPath, 'utf8'), pyproject, opts);
        lockfile = 'poetry-lock';
    }
    else if (fs.existsSync(requirementsPath)) {
        parsed = fromRequirementsTxt(fs.readFileSync(requirementsPath, 'utf8'));
        lockfile = 'requirements-txt';
    }
    else if (fs.existsSync(pyprojectPath)) {
        parsed = declaredOnlyFromPyproject(fs.readFileSync(pyprojectPath, 'utf8'), opts);
        lockfile = 'pyproject-declared';
    }
    else {
        // detect() returned true but none of the four files exist now — treat as
        // an empty project rather than crashing.
        parsed = { packages: [], warnings: [] };
        lockfile = 'none';
    }
    warnings.push(...parsed.warnings);
    // Project's own identity: prefer pyproject.toml's [project] / [tool.poetry]
    // declared name and license; fall back to the directory basename for the name
    // and leave the license undefined (the CLI layer decides "unspecified").
    let projectName = path.basename(projectPath);
    let projectLicenseRaw;
    if (fs.existsSync(pyprojectPath)) {
        try {
            const identity = readPyprojectIdentity(fs.readFileSync(pyprojectPath, 'utf8'));
            if (identity.name)
                projectName = identity.name;
            projectLicenseRaw = identity.license;
        }
        catch {
            /* fall back to basename, no declared license */
        }
    }
    return {
        projectName,
        ecosystems: ['pypi'],
        lockfile,
        packages: toScannedPackages(parsed.packages, resolver),
        warnings,
        projectLicenseRaw,
    };
}
/**
 * Minimal identity read (project name + declared license) from pyproject.toml.
 * Uses the same TOML parser. Mirrors what `manifest.license` provides for npm:
 * a raw declared-license string the CLI layer feeds into
 * `resolveProjectLicenseContext`. Returns undefined for `license` when none is
 * declared as a usable SPDX-string form.
 *
 * The PEP 621 `[project.license]` field has two accepted shapes, plus the older
 * legacy Poetry form:
 *   - a table with a `text` key: `license = { text = "MIT" }`
 *   - a bare SPDX-expression string (PEP 639, newer tooling): `license = "MIT"`
 *   - legacy Poetry: `[tool.poetry] license = "MIT"`
 * A `license = { file = "LICENSE" }` table points at a file rather than
 * declaring an id, so no SPDX string is derivable — treated as "not declared"
 * (undefined), exactly like npm's non-string `license` field shapes.
 */
function readPyprojectIdentity(contents) {
    const result = {};
    try {
        const doc = (0, smol_toml_1.parse)(contents);
        const project = doc.project;
        if (project) {
            if (typeof project.name === 'string')
                result.name = project.name;
            const lic = project.license;
            if (typeof lic === 'string' && lic.trim()) {
                result.license = lic;
            }
            else if (lic && typeof lic === 'object' && !Array.isArray(lic)) {
                const text = lic.text;
                if (typeof text === 'string' && text.trim())
                    result.license = text;
            }
        }
        // Legacy Poetry-only identity, used only when [project] didn't supply the field.
        const tool = doc.tool;
        const poetry = tool?.poetry;
        if (poetry) {
            if (result.name === undefined && typeof poetry.name === 'string')
                result.name = poetry.name;
            if (result.license === undefined && typeof poetry.license === 'string' && poetry.license.trim()) {
                result.license = poetry.license;
            }
        }
    }
    catch {
        /* ignore — return whatever was gathered before the throw */
    }
    return result;
}
exports.pypiEcosystem = { id: 'pypi', detect, scan };
//# sourceMappingURL=pypi.js.map