import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { verifyLicenseKey } from '../../src/license/verify';

// The real individual-tier key issued by scripts/keygen/issue.mjs (M6 Task 1),
// signed by the committed public key. Verifies here with zero setup.
const REAL_KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KEYGEN_MJS = path.resolve(REPO_ROOT, 'scripts', 'keygen', 'lib', 'keyFormat.mjs');
const PRIVATE_KEY_PATH = path.resolve(REPO_ROOT, '..', 'licenseproof-signing-key', 'signing-key');
// Forging needs BOTH halves of the signing side: the private key AND the
// keygen wire-format module. The public mirror intentionally ships no
// scripts/keygen/, so there the forge path can't run and its tests skip.
const CAN_FORGE = fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(KEYGEN_MJS);

/**
 * Forge a key signed by the REAL private key, using the .mjs signing side's
 * `buildPayloadBytes` product override (the exact hook M6 Task 1 built for this
 * test). Runs in a child node process so the shipped TS test never has to import
 * the never-shipped ESM .mjs across the tsc boundary. Returns the `P.S` string.
 * Only callable when the private key AND scripts/keygen/ are both present
 * (the private repo); tests that use it are skipped otherwise.
 */
function forgeKey(product: string): string {
  const mjsUrl = pathToFileURL(KEYGEN_MJS).href;
  const script = `
    import * as crypto from 'crypto';
    import * as fs from 'fs';
    const m = await import(${JSON.stringify(mjsUrl)});
    const priv = crypto.createPrivateKey(fs.readFileSync(${JSON.stringify(PRIVATE_KEY_PATH)}, 'utf8'));
    const payload = m.buildPayloadBytes({
      product: ${JSON.stringify(product)},
      tier: 'individual',
      licenseId: 'FORGED1234',
      issuedAt: '2026-07-22T00:00:00.000Z',
      updatesUntil: '2027-07-22T00:00:00.000Z',
    });
    const sig = crypto.sign(null, payload, priv);
    process.stdout.write(m.base64urlEncode(payload) + '.' + m.base64urlEncode(sig));
  `;
  return execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

describe('verifyLicenseKey — accepts a genuine key', () => {
  it('returns the full LicenseInfo for the real issued key', () => {
    expect(verifyLicenseKey(REAL_KEY)).toEqual({
      product: 'licenseproof',
      tier: 'individual',
      licenseId: 'E9YM3AUMWC',
      issuedAt: '2026-07-22T23:24:35.650Z',
      updatesUntil: '2027-07-22T23:24:35.650Z',
    });
  });

  it('tolerates surrounding whitespace (an email-paste stray newline)', () => {
    expect(verifyLicenseKey(`\n  ${REAL_KEY}\t\n`)).not.toBeNull();
  });
});

describe('verifyLicenseKey — never throws, returns null on adversarial input', () => {
  it('empty string → null', () => {
    expect(verifyLicenseKey('')).toBeNull();
  });

  it('non-string inputs → null (undefined, number, object, null)', () => {
    expect(verifyLicenseKey(undefined)).toBeNull();
    expect(verifyLicenseKey(12345)).toBeNull();
    expect(verifyLicenseKey({})).toBeNull();
    expect(verifyLicenseKey(null)).toBeNull();
  });

  it('a string with no "." separator → null', () => {
    expect(verifyLicenseKey('not-a-key-at-all')).toBeNull();
  });

  it('a bit-flipped signature → null (tamper rejection)', () => {
    const lastDot = REAL_KEY.lastIndexOf('.');
    const s = REAL_KEY.slice(lastDot + 1);
    // Flip the first signature character to a different valid base64url char.
    const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const tampered = REAL_KEY.slice(0, lastDot + 1) + flipped;
    expect(tampered).not.toBe(REAL_KEY);
    expect(verifyLicenseKey(tampered)).toBeNull();
  });

  it('a truncated key → null', () => {
    expect(verifyLicenseKey(REAL_KEY.slice(0, Math.floor(REAL_KEY.length / 2)))).toBeNull();
  });

  it('a key with extra trailing garbage → null', () => {
    expect(verifyLicenseKey(REAL_KEY + 'GARBAGE')).toBeNull();
  });

  it('a key with an extra trailing ".garbage" segment → null', () => {
    expect(verifyLicenseKey(REAL_KEY + '.GARBAGE')).toBeNull();
  });
});

// The central security test: a key VALIDLY SIGNED by the real private key but
// carrying a DIFFERENT product string must still be rejected (the
// product-confusion guard). Constructed via the .mjs override hook + the real
// private key; runs wherever both the private key and scripts/keygen/ are
// present, and skips in the public mirror, which ships neither.
describe.skipIf(!CAN_FORGE)('verifyLicenseKey — product-confusion guard (real signature)', () => {
  it('a validly-signed key for a DIFFERENT product is rejected', () => {
    const wrongProductKey = forgeKey('some-other-product');
    // Sanity: it really is signed by the real key — the SAME forge path with the
    // correct product DOES verify, so rejection is due to product, not signature.
    const correctProductKey = forgeKey('licenseproof');
    expect(verifyLicenseKey(correctProductKey)).not.toBeNull();
    expect(verifyLicenseKey(correctProductKey)!.licenseId).toBe('FORGED1234');

    expect(verifyLicenseKey(wrongProductKey)).toBeNull();
  });
});
