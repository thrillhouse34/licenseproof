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
exports.detectYarnLockFormat = detectYarnLockFormat;
exports.parseYarnClassicLock = parseYarnClassicLock;
exports.parseYarnBerryLock = parseYarnBerryLock;
const YAML = __importStar(require("yaml"));
const dependencyGraph_1 = require("../dependencyGraph");
function detectYarnLockFormat(contents) {
    return contents.includes('__metadata:') ? 'berry' : 'classic';
}
function nameFromDescriptor(descriptor) {
    const cleaned = descriptor.replace(/^npm:/, '');
    const lastAt = cleaned.lastIndexOf('@');
    return lastAt > 0 ? cleaned.slice(0, lastAt) : cleaned;
}
function findBlockByDescriptor(blocks, depName, depRange, prefix) {
    const target = `${depName}@${prefix}${depRange}`;
    return blocks.find((b) => b.descriptors.includes(target));
}
function buildGraphAndPackages(rootBlock, blocks, rootDeps, descriptorPrefix, opts, rootDevDependencyNames) {
    // rootBlock is a freshly-allocated sentinel object, distinct from every
    // real block by identity (LockBlock keys are compared by reference, not
    // value) — it can never collide with a real dependency block, unlike a
    // string sentinel that would need to avoid colliding with real names.
    const getNode = (block) => ({ key: block, dependencies: block.dependencies });
    const resolveEdge = (_from, depName, depRange) => findBlockByDescriptor(blocks, depName, depRange, descriptorPrefix);
    const nameForKey = (block) => block.name;
    const rootProdDeps = {};
    const rootDevDeps = {};
    for (const [name, range] of Object.entries(rootDeps)) {
        if (rootDevDependencyNames.includes(name))
            rootDevDeps[name] = range;
        else
            rootProdDeps[name] = range;
    }
    const prodOnlyPaths = (0, dependencyGraph_1.buildPaths)({ rootKey: rootBlock, rootDependencies: rootProdDeps, getNode, resolveEdge, nameForKey });
    const allPaths = (0, dependencyGraph_1.buildPaths)({ rootKey: rootBlock, rootDependencies: rootDeps, getNode, resolveEdge, nameForKey });
    const directBlocks = new Set();
    for (const [name, range] of Object.entries(rootDeps)) {
        const block = findBlockByDescriptor(blocks, name, range, descriptorPrefix);
        if (block)
            directBlocks.add(block);
    }
    const packages = [];
    for (const block of blocks) {
        const pathInfo = allPaths.get(block);
        if (!pathInfo)
            continue;
        const isDev = !prodOnlyPaths.has(block);
        if (opts.productionOnly && isDev)
            continue;
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
function parseYarnClassicLock(contents, opts, rootDependencyRanges, rootDevDependencyNames) {
    const blocks = [];
    const lines = contents.split('\n');
    let currentDescriptors = [];
    let currentVersion = '';
    let currentDeps = {};
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
        if (line.startsWith('#') || line.trim() === '')
            continue;
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
    const rootBlock = { descriptors: [], name: '', version: '', dependencies: {} };
    return buildGraphAndPackages(rootBlock, blocks, rootDependencyRanges, '', opts, rootDevDependencyNames);
}
function parseYarnBerryLock(contents, opts, rootDependencyRanges, rootDevDependencyNames) {
    const doc = YAML.parse(contents);
    const blocks = [];
    for (const [key, entry] of Object.entries(doc)) {
        if (key === '__metadata')
            continue;
        const descriptors = key.split(',').map((d) => d.trim().replace(/^"|"$/g, ''));
        const deps = {};
        const allDeclaredDeps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
        for (const [depName, depRangeWithPrefix] of Object.entries(allDeclaredDeps)) {
            deps[depName] = String(depRangeWithPrefix).replace(/^npm:/, '');
        }
        blocks.push({ descriptors, name: nameFromDescriptor(descriptors[0]), version: entry.version, dependencies: deps });
    }
    // Same synthetic-root pattern as parseYarnClassicLock — a fresh sentinel
    // object never added to `blocks`, so it's never mistaken for a real block.
    const rootBlock = { descriptors: [], name: '', version: '', dependencies: {} };
    return buildGraphAndPackages(rootBlock, blocks, rootDependencyRanges, 'npm:', opts, rootDevDependencyNames);
}
//# sourceMappingURL=yarnLockParser.js.map