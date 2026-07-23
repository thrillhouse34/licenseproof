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
exports.readLicenseFile = readLicenseFile;
exports.resolveProject = resolveProject;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const licenseResolver_1 = require("./licenseResolver");
const dataManifest_1 = require("./dataManifest");
const pypiMetadata_1 = require("./pypiMetadata");
/**
 * Exported (Milestone 5 Task 4) so `src/report/notices.ts` can reuse this exact
 * candidate-filename + `licenses/` subdirectory logic to read a package's own
 * on-disk license file via its confirmed `diskPath`, instead of re-implementing
 * file-finding a third time. Behavior is unchanged for every existing caller —
 * this is a pure visibility change, no logic touched.
 */
function readLicenseFile(dir) {
    const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING'];
    for (const name of candidates) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
            try {
                return fs.readFileSync(p, 'utf8');
            }
            catch {
                return undefined;
            }
        }
    }
    // Modern wheel spec (PyPI): a package's license files are shipped inside a
    // `licenses/` subdirectory of the `.dist-info` dir rather than at its root.
    // Additive — only consulted after the flat candidate list above misses, so
    // existing npm behavior (no `licenses/` subdir) is unaffected. Prefer a file
    // named LICENSE/LICENCE/COPYING (case-insensitive); otherwise fall back to the
    // first file present at all, per the spec convention.
    const licensesDir = path.join(dir, 'licenses');
    if (fs.existsSync(licensesDir)) {
        let files = [];
        try {
            files = fs.readdirSync(licensesDir, { withFileTypes: true })
                .filter((e) => e.isFile())
                .map((e) => e.name);
        }
        catch {
            files = [];
        }
        const target = files.find((f) => /^(LICENSE|LICENCE|COPYING)/i.test(f)) ?? files[0];
        if (target) {
            try {
                return fs.readFileSync(path.join(licensesDir, target), 'utf8');
            }
            catch {
                return undefined;
            }
        }
    }
    return undefined;
}
/**
 * Read and parse a PyPI package's `.dist-info/METADATA` file from its confirmed
 * on-disk location (`diskPath` points AT the `.dist-info`/`.egg-info` dir).
 * Returns undefined when the file is absent or unreadable — resolution then
 * falls through exactly as it would for a package with no metadata signal.
 */
function readPyPiMetadata(projectPath, diskPath) {
    const metadataPath = path.join(projectPath, diskPath, 'METADATA');
    if (!fs.existsSync(metadataPath))
        return undefined;
    try {
        return (0, pypiMetadata_1.parseMetadata)(fs.readFileSync(metadataPath, 'utf8'));
    }
    catch {
        return undefined;
    }
}
function readReadme(dir) {
    const candidates = ['README.md', 'README', 'readme.md'];
    for (const name of candidates) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
            try {
                return fs.readFileSync(p, 'utf8');
            }
            catch {
                return undefined;
            }
        }
    }
    return undefined;
}
function readDiskContent(projectPath, diskPath, licenseRaw) {
    if (!diskPath)
        return {}; // no verified on-disk location — resolution falls through, no guessing
    const absoluteDir = path.join(projectPath, diskPath);
    const seeLicenseMatch = licenseRaw?.match(/^SEE LICENSE IN (.+)$/i);
    if (seeLicenseMatch) {
        const resolvedAbsoluteDir = path.resolve(absoluteDir);
        const referencedFile = path.resolve(path.join(resolvedAbsoluteDir, seeLicenseMatch[1].trim()));
        const staysWithinPackageDir = referencedFile === resolvedAbsoluteDir || referencedFile.startsWith(resolvedAbsoluteDir + path.sep);
        if (!staysWithinPackageDir) {
            // Containment escape: a package.json referencing a license file
            // outside its own directory is untrustworthy. Record UNKNOWN rather
            // than silently falling back to this package's own LICENSE/README,
            // and never read or expose the escaping path anywhere. The caller
            // uses seeLicenseEscaped to also scrub the raw "SEE LICENSE IN ..."
            // string itself out of the resolved package's output, since
            // ResolvedPackage otherwise carries pkg.licenseRaw through verbatim.
            return { seeLicenseEscaped: true };
        }
        if (fs.existsSync(referencedFile)) {
            try {
                return { licenseFileText: fs.readFileSync(referencedFile, 'utf8') };
            }
            catch { /* fall through to standard candidates below */ }
        }
    }
    const licenseFileText = readLicenseFile(absoluteDir);
    const readmeText = licenseFileText ? undefined : readReadme(absoluteDir);
    return { licenseFileText, readmeText };
}
function resolveProject(projectPath, scanResult, projectLicenseId) {
    const packages = scanResult.packages.map((pkg) => {
        const { licenseFileText, readmeText, seeLicenseEscaped } = readDiskContent(projectPath, pkg.diskPath, pkg.licenseRaw);
        // On a detected containment escape, resolve from a sanitized copy of pkg
        // with licenseRaw stripped — otherwise the escaping "SEE LICENSE IN ..."
        // string would still reach the final output via ResolvedPackage's
        // pass-through of the original scanned package fields.
        const pkgForResolution = seeLicenseEscaped ? { ...pkg, licenseRaw: undefined } : pkg;
        // PyPI packages carry no license field in the lockfile — their real license
        // lives in the installed package's own METADATA file, read here from the
        // fs-confirmed diskPath and passed into the resolver's PyPI branch.
        const pypiMetadata = pkg.ecosystem === 'pypi' && pkg.diskPath
            ? readPyPiMetadata(projectPath, pkg.diskPath)
            : undefined;
        return (0, licenseResolver_1.resolveLicenseForPackage)(pkgForResolution, licenseFileText, readmeText, projectLicenseId, pypiMetadata);
    });
    return { packages, dataVersion: (0, dataManifest_1.getDataVersion)() };
}
//# sourceMappingURL=resolveProject.js.map