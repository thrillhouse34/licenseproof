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
exports.licenseKeyPath = licenseKeyPath;
exports.discoverLicenseKey = discoverLicenseKey;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/**
 * The on-disk location an activated key is stored at:
 * `~/.config/licenseproof/license.key`. Shared by discovery, `activate`, and
 * `deactivate` so all three agree on one path.
 */
function licenseKeyPath() {
    return path.join(os.homedir(), '.config', 'licenseproof', 'license.key');
}
/**
 * Resolve a license key string from the standard discovery order, or `undefined`
 * if none is present:
 *
 *   1. explicit `--key <string>` (the `cliKey` argument)
 *   2. `LICENSEPROOF_KEY` environment variable
 *   3. `~/.config/licenseproof/license.key` file content
 *
 * A higher-priority source is used only when present and non-empty; the env var
 * and file are consulted lazily (the file is only read when both the CLI key and
 * env var are absent). Every source is trimmed — a stored/pasted key may carry a
 * trailing newline. This function only LOCATES a key; it does not verify it —
 * `verifyLicenseKey` is the sole authority on validity.
 */
function discoverLicenseKey(opts = {}) {
    const cli = opts.cliKey?.trim();
    if (cli)
        return cli;
    const env = opts.env ?? process.env;
    const fromEnv = env.LICENSEPROOF_KEY?.trim();
    if (fromEnv)
        return fromEnv;
    const filePath = opts.keyFilePath ?? licenseKeyPath();
    try {
        const fromFile = fs.readFileSync(filePath, 'utf8').trim();
        if (fromFile)
            return fromFile;
    }
    catch {
        // Absent or unreadable file → no key from this source.
    }
    return undefined;
}
//# sourceMappingURL=discovery.js.map