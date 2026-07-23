"use strict";
// Base64url (RFC 4648 §5) codec + license-key payload construction — VERIFY side.
//
// SHIPPED counterpart to scripts/keygen/lib/keyFormat.mjs (the signing side,
// never shipped). The two live on opposite sides of the tsc / never-shipped
// boundary and CANNOT share one file, so base64url encode/decode and the
// payload-byte construction are DELIBERATELY re-implemented independently here
// in TypeScript. That duplication is proven correct not by textual identity but
// by a behavioral round-trip test (tests/license/keyFormat.test.ts): a REAL key
// issued by the .mjs signing side is decoded here and its payload segment is
// re-encoded by the functions below, and the bytes must match exactly. See the
// M6 plan's "shared key-format logic" note for why this is the pragmatic choice.
//
// Wire format (binding, foundations_addendum.md §2 + the M6 plan):
//   payload bytes = Buffer.from(JSON.stringify({product, tier, licenseId,
//                     issuedAt, updatesUntil}), 'utf8')
//   P = base64url(payload bytes)
//   S = base64url(raw 64-byte Ed25519 signature of the payload bytes)
//   customer key string = `${P}.${S}`  (one '.' separator, no padding/whitespace)
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT = void 0;
exports.base64urlEncode = base64urlEncode;
exports.base64urlDecode = base64urlDecode;
exports.buildPayloadBytes = buildPayloadBytes;
/** The one and only product string a genuine LicenseProof key ever carries. */
exports.PRODUCT = 'licenseproof';
/**
 * Base64url-encode bytes per RFC 4648 §5: '+' -> '-', '/' -> '_', no '=' padding.
 * Independent re-implementation of the signing side's `base64urlEncode`; used
 * only by the round-trip agreement test (the verifier itself never re-encodes).
 */
function base64urlEncode(bytes) {
    return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
/**
 * Base64url-decode a string back to a Buffer. Symmetric inverse of
 * `base64urlEncode`. `Buffer.from(..., 'base64')` tolerates missing padding, so
 * no re-padding step is needed. Never throws on malformed input — it decodes
 * whatever prefix is valid base64 and stops — so the caller (verify.ts) can rely
 * on a subsequent signature/length check to reject garbage rather than needing
 * this to fail loudly.
 */
function base64urlDecode(str) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
/**
 * Reconstruct the exact bytes that were signed and base64url-encoded as segment
 * P. Independent re-implementation of the signing side's `buildPayloadBytes`.
 * `product` defaults to the literal "licenseproof". The verifier does NOT use
 * this to check signatures (it verifies against the raw decoded P bytes, since a
 * re-stringify could differ in field order or whitespace from the original) —
 * this exists purely so the round-trip test can prove the TS encode agrees with
 * the .mjs encode byte-for-byte on a real key's fields.
 */
function buildPayloadBytes({ product = exports.PRODUCT, tier, licenseId, issuedAt, updatesUntil, }) {
    return Buffer.from(JSON.stringify({
        product,
        tier,
        licenseId,
        issuedAt,
        updatesUntil,
    }), 'utf8');
}
//# sourceMappingURL=keyFormat.js.map