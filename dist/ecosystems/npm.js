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
exports.npmEcosystem = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const packageLockParser_1 = require("./npm/packageLockParser");
const pnpmLockParser_1 = require("./npm/pnpmLockParser");
const yarnLockParser_1 = require("./npm/yarnLockParser");
function detect(projectPath) {
    return fs.existsSync(path.join(projectPath, 'package.json'));
}
function readManifest(projectPath) {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8');
    return JSON.parse(raw);
}
function resolveDiskPath(projectPath, installPaths) {
    for (const candidate of installPaths) {
        const full = path.join(projectPath, candidate);
        if (fs.existsSync(full))
            return candidate;
    }
    return undefined;
}
function filterByDiskPresence(projectPath, packages) {
    let excludedCount = 0;
    const kept = packages.filter((p) => {
        if (!p.optional && !p.peer)
            return true;
        const onDisk = resolveDiskPath(projectPath, p.installPaths) !== undefined;
        if (!onDisk)
            excludedCount++;
        return onDisk;
    });
    return { kept, excludedCount };
}
function toScannedPackages(projectPath, packages) {
    return packages.map((p) => ({
        name: p.name,
        version: p.version,
        ecosystem: 'npm',
        direct: p.direct,
        dev: p.dev,
        paths: p.paths,
        pathCountAtLeast: p.pathCountAtLeast,
        licenseRaw: p.licenseRaw,
        installPath: p.installPaths[0],
        diskPath: resolveDiskPath(projectPath, p.installPaths),
    }));
}
function declaredDepsOnlyFallback(manifest, opts) {
    const packages = [];
    const addAll = (deps, dev) => {
        if (!deps)
            return;
        if (dev && opts.productionOnly)
            return;
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
function nodeModulesWalkFallback(projectPath, manifest, opts) {
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    const declaredDeps = new Set(Object.keys(manifest.dependencies ?? {}));
    const declaredDevDeps = new Set(Object.keys(manifest.devDependencies ?? {}));
    const packageDirs = [];
    for (const entry of fs.readdirSync(nodeModulesPath, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        if (entry.name.startsWith('@')) {
            const scopeDir = path.join(nodeModulesPath, entry.name);
            for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
                if (scoped.isDirectory())
                    packageDirs.push(`${entry.name}/${scoped.name}`);
            }
        }
        else if (!entry.name.startsWith('.')) {
            packageDirs.push(entry.name);
        }
    }
    const packages = [];
    for (const name of packageDirs) {
        const pkgJsonPath = path.join(nodeModulesPath, name, 'package.json');
        if (!fs.existsSync(pkgJsonPath))
            continue;
        let pkgJson;
        try {
            pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        }
        catch {
            continue; // malformed package.json on disk — skip rather than crash the whole scan
        }
        const isDev = declaredDevDeps.has(name) && !declaredDeps.has(name);
        if (opts.productionOnly && isDev)
            continue;
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
async function scan(projectPath, opts) {
    const manifest = readManifest(projectPath);
    const warnings = [];
    const hasWorkspaces = !!manifest.workspaces;
    if (hasWorkspaces) {
        warnings.push('Monorepo workspaces not supported in v1 — scanning root package only.');
    }
    const packageLockPath = path.join(projectPath, 'package-lock.json');
    const pnpmLockPath = path.join(projectPath, 'pnpm-lock.yaml');
    const yarnLockPath = path.join(projectPath, 'yarn.lock');
    let lockfileKind = 'none';
    let parsed;
    if (fs.existsSync(packageLockPath)) {
        lockfileKind = 'package-lock';
        parsed = (0, packageLockParser_1.parsePackageLock)(fs.readFileSync(packageLockPath, 'utf8'), opts);
    }
    else if (fs.existsSync(pnpmLockPath)) {
        lockfileKind = 'pnpm';
        parsed = (0, pnpmLockParser_1.parsePnpmLock)(fs.readFileSync(pnpmLockPath, 'utf8'), opts);
    }
    else if (fs.existsSync(yarnLockPath)) {
        const contents = fs.readFileSync(yarnLockPath, 'utf8');
        const devNames = Object.keys(manifest.devDependencies ?? {});
        // yarn.lock has no root entry of its own — root's declared ranges come
        // straight from package.json, exactly as read here (see Task 4's note
        // on why this must be a real parameter, not reconstructed from blocks).
        const rootDependencyRanges = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
        if ((0, yarnLockParser_1.detectYarnLockFormat)(contents) === 'berry') {
            lockfileKind = 'yarn-berry';
            parsed = (0, yarnLockParser_1.parseYarnBerryLock)(contents, opts, rootDependencyRanges, devNames);
        }
        else {
            lockfileKind = 'yarn-classic';
            parsed = (0, yarnLockParser_1.parseYarnClassicLock)(contents, opts, rootDependencyRanges, devNames);
        }
    }
    else if (fs.existsSync(path.join(projectPath, 'node_modules'))) {
        parsed = nodeModulesWalkFallback(projectPath, manifest, opts);
    }
    else {
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
exports.npmEcosystem = { id: 'npm', detect, scan };
//# sourceMappingURL=npm.js.map