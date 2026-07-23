import * as crypto from 'crypto';
import { PUBLIC_KEY_SPKI_DER_BASE64 } from './publicKey';
import { base64urlDecode, PRODUCT } from './keyFormat';

/**
 * The verified, trusted contents of a genuine LicenseProof license key. Every
 * field is the exact value that was signed. `product` is always the literal
 * "licenseproof" (the verifier rejects anything else before ever returning),
 * kept on the shape so a caller can assert it if it wants to.
 */
export interface LicenseInfo {
  product: string;
  tier: string;
  licenseId: string;
  issuedAt: string;
  updatesUntil: string;
}

// Reconstruct the Ed25519 public KeyObject once from the committed SPKI-DER
// base64 constant (src/license/publicKey.ts). This is the sole root of trust;
// verification is 100% offline, no network call, ever (addendum §2 / §4).
let cachedPublicKey: crypto.KeyObject | undefined;
function getPublicKey(): crypto.KeyObject {
  if (!cachedPublicKey) {
    cachedPublicKey = crypto.createPublicKey({
      key: Buffer.from(PUBLIC_KEY_SPKI_DER_BASE64, 'base64'),
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
export function verifyLicenseKey(keyString: unknown): LicenseInfo | null {
  try {
    if (typeof keyString !== 'string') return null;
    const key = keyString.trim();
    if (key.length === 0) return null;

    const lastDot = key.lastIndexOf('.');
    // Need a non-empty P before the dot and a non-empty S after it.
    if (lastDot <= 0 || lastDot === key.length - 1) return null;

    const payloadBytes = base64urlDecode(key.slice(0, lastDot));
    const signature = base64urlDecode(key.slice(lastDot + 1));
    if (payloadBytes.length === 0) return null;
    // Ed25519 signatures are exactly 64 bytes; a wrong length can never verify.
    if (signature.length !== 64) return null;

    if (!crypto.verify(null, payloadBytes, getPublicKey(), signature)) return null;

    const parsed: unknown = JSON.parse(payloadBytes.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;

    if (p.product !== PRODUCT) return null;
    if (
      typeof p.tier !== 'string' ||
      typeof p.licenseId !== 'string' ||
      typeof p.issuedAt !== 'string' ||
      typeof p.updatesUntil !== 'string'
    ) {
      return null;
    }

    return {
      product: p.product,
      tier: p.tier,
      licenseId: p.licenseId,
      issuedAt: p.issuedAt,
      updatesUntil: p.updatesUntil,
    };
  } catch {
    // Any unexpected throw (bad base64 edge, malformed JSON, crypto error) is a
    // rejection, never a crash.
    return null;
  }
}
