"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_KEY_SPKI_DER_BASE64 = void 0;
/**
 * The real, permanent Ed25519 PUBLIC key for verifying LicenseProof license keys.
 *
 * This is the SPKI DER encoding of the signing keypair's public half, then
 * base64-encoded. It ships with every install and is the sole root of trust for
 * fully-offline license verification (foundations_addendum.md §2; the Milestone 6
 * key wire-format spec). Verification never makes a network call.
 *
 * DO NOT REGENERATE OR EDIT THIS ONCE REAL LICENSE KEYS EXIST IN THE WILD. Every
 * license key is signed by the matching private half, managed entirely OUTSIDE
 * this repo in separate, out-of-band storage (its real location is deliberately
 * not recorded here) — keys can never be reissued, so changing this constant
 * would instantly invalidate every license already sold. It was generated once
 * by scripts/keygen/generateSigningKey.mjs and is permanent.
 */
exports.PUBLIC_KEY_SPKI_DER_BASE64 = 'MCowBQYDK2VwAyEAJUBiSMoEDB4p4ykYz4UB6SRHFBwlfO1PnmoGq5teljM=';
//# sourceMappingURL=publicKey.js.map