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
exports.verifyLicenseKey = verifyLicenseKey;
const crypto = __importStar(require("crypto"));
const publicKey_1 = require("./publicKey");
const keyFormat_1 = require("./keyFormat");
// Reconstruct the Ed25519 public KeyObject once from the committed SPKI-DER
// base64 constant (src/license/publicKey.ts). This is the sole root of trust;
// verification is 100% offline, no network call, ever (addendum §2 / §4).
let cachedPublicKey;
function getPublicKey() {
    if (!cachedPublicKey) {
        cachedPublicKey = crypto.createPublicKey({
            key: Buffer.from(publicKey_1.PUBLIC_KEY_SPKI_DER_BASE64, 'base64'),
            format: 'der',
            type: 'spki',
        });
    }
    return cachedPublicKey;
}
/**
 * Verify a license key string and return its trusted contents, or `null`.
 *
 * This is the actual business-model enforcement mechanism. It NEVER throws — the
 * same "never throws" contract the SPDX-expression parser holds elsewhere in
 * this codebase. Feed it anything (garbage, truncated strings, a bit-flipped
 * signature, wrong JSON, a validly-signed key for a DIFFERENT product) and it
 * returns `null` on any failure at any step.
 *
 * Steps (the M6 wire format, decode/verify half):
 *  1. Trim surrounding whitespace (tolerates an email-paste stray newline).
 *  2. Split on the LAST '.' — base64url never contains '.', so the segment
 *     boundary is unambiguous. Reject if either segment is empty.
 *  3. base64url-decode P (payload bytes) and S (raw signature).
 *  4. `crypto.verify(null, payloadBytes, publicKey, signature)` — the `null`
 *     digest is required for Ed25519 (no pre-hash step).
 *  5. On a good signature, JSON.parse the payload bytes.
 *  6. Reject unless `product === "licenseproof"` — the product-confusion guard:
 *     a key legitimately signed by the same private key but issued for a
 *     different product in a future product family can never activate this tool.
 *  7. Reject unless every expected field is a string.
 */
function verifyLicenseKey(keyString) {
    try {
        if (typeof keyString !== 'string')
            return null;
        const key = keyString.trim();
        if (key.length === 0)
            return null;
        const lastDot = key.lastIndexOf('.');
        // Need a non-empty P before the dot and a non-empty S after it.
        if (lastDot <= 0 || lastDot === key.length - 1)
            return null;
        const payloadBytes = (0, keyFormat_1.base64urlDecode)(key.slice(0, lastDot));
        const signature = (0, keyFormat_1.base64urlDecode)(key.slice(lastDot + 1));
        if (payloadBytes.length === 0)
            return null;
        // Ed25519 signatures are exactly 64 bytes; a wrong length can never verify.
        if (signature.length !== 64)
            return null;
        if (!crypto.verify(null, payloadBytes, getPublicKey(), signature))
            return null;
        const parsed = JSON.parse(payloadBytes.toString('utf8'));
        if (parsed === null || typeof parsed !== 'object')
            return null;
        const p = parsed;
        if (p.product !== keyFormat_1.PRODUCT)
            return null;
        if (typeof p.tier !== 'string' ||
            typeof p.licenseId !== 'string' ||
            typeof p.issuedAt !== 'string' ||
            typeof p.updatesUntil !== 'string') {
            return null;
        }
        return {
            product: p.product,
            tier: p.tier,
            licenseId: p.licenseId,
            issuedAt: p.issuedAt,
            updatesUntil: p.updatesUntil,
        };
    }
    catch {
        // Any unexpected throw (bad base64 edge, malformed JSON, crypto error) is a
        // rejection, never a crash.
        return null;
    }
}
//# sourceMappingURL=verify.js.map