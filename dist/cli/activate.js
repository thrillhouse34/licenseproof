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
exports.runActivate = runActivate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const verify_1 = require("../license/verify");
const keyFormat_1 = require("../license/keyFormat");
const discovery_1 = require("../license/discovery");
/**
 * Best-effort, cheap classification of WHY a key failed to verify, purely to
 * make the error message more helpful. This never trusts the payload — the key
 * has already failed cryptographic verification — it only peeks at the
 * (unverified) format to distinguish the three failure kinds the plan asks for:
 * malformed format vs. a well-formed key for a different product vs. a bad or
 * corrupted signature.
 */
function explainFailure(key) {
    const lastDot = key.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === key.length - 1) {
        return 'that does not look like a license key (expected a single line with one "." separator).';
    }
    try {
        const parsed = JSON.parse((0, keyFormat_1.base64urlDecode)(key.slice(0, lastDot)).toString('utf8'));
        if (parsed && typeof parsed === 'object' && parsed.product !== keyFormat_1.PRODUCT) {
            return 'this key is for a different product, not LicenseProof.';
        }
    }
    catch {
        // Fall through to the generic signature message.
    }
    return 'the license key could not be verified. It may be corrupted, incomplete, or not a genuine LicenseProof key.';
}
/**
 * `licenseproof activate <key>` — verify a license key and, on success, store it
 * at `~/.config/licenseproof/license.key` so the `report` command's gated
 * formats unlock on every later run.
 *
 * On failure: a clear error naming why (invalid format / wrong product / bad
 * signature), NOTHING is written, exit code 2 (a usage/input error, matching the
 * existing bad-CLI-input convention). On success: the raw key is written
 * (creating `~/.config/licenseproof/` if needed), a confirmation names the tier
 * and that reports are unlocked, exit code 0.
 */
function runActivate(keyString, opts = {}) {
    const key = (keyString ?? '').trim();
    if (key === '') {
        return {
            exitCode: 2,
            output: 'licenseproof activate: no key provided.\nUsage: licenseproof activate <key>',
        };
    }
    const info = (0, verify_1.verifyLicenseKey)(key);
    if (!info) {
        return {
            exitCode: 2,
            output: `licenseproof activate: ${explainFailure(key)} Nothing was written.`,
        };
    }
    const target = opts.keyFilePath ?? (0, discovery_1.licenseKeyPath)();
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Store the exact key the customer holds (mode 0600 — it's theirs alone).
        fs.writeFileSync(target, key, { mode: 0o600 });
    }
    catch (err) {
        return {
            exitCode: 2,
            output: `licenseproof activate: could not write the license file at ${target}: ${err.message}`,
        };
    }
    return {
        exitCode: 0,
        output: `licenseproof: activated your ${info.tier} license. The report command is now ` +
            `unlocked — audit-ready HTML and PDF reports, third-party notices, and SBOM output.`,
    };
}
//# sourceMappingURL=activate.js.map