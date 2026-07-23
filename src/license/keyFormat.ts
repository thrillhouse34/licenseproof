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

/** The one and only product string a genuine LicenseProof key ever carries. */
export const PRODUCT = 'licenseproof';

/** The five payload fields, in the canonical insertion order used for signing. */
export interface LicensePayloadFields {
  product?: string;
  tier: string;
  licenseId: string;
  issuedAt: string;
  updatesUntil: string;
}

/**
 * Base64url-encode bytes per RFC 4648 §5: '+' -> '-', '/' -> '_', no '=' padding.
 * Independent re-implementation of the signing side's `base64urlEncode`; used
 * only by the round-trip agreement test (the verifier itself never re-encodes).
 */
export function base64urlEncode(bytes: Buffer | Uint8Array): string {
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
export function base64urlDecode(str: string): Buffer {
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
export function buildPayloadBytes({
  product = PRODUCT,
  tier,
  licenseId,
  issuedAt,
  updatesUntil,
}: LicensePayloadFields): Buffer {
  return Buffer.from(
    JSON.stringify({
      product,
      tier,
      licenseId,
      issuedAt,
      updatesUntil,
    }),
    'utf8',
  );
}
