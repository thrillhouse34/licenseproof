import { describe, it, expect } from 'vitest';
import { base64urlEncode, base64urlDecode, buildPayloadBytes, PRODUCT } from '../../src/license/keyFormat';

// A REAL license key issued by the signing side (scripts/keygen/issue.mjs) and
// recorded in the M6 Task 1 progress ledger. Using the actual issued key proves
// the independently-implemented TS codec agrees with the .mjs signing side
// BEHAVIORALLY (round-trip), not by textual identity — the stronger proof the
// M6 plan's "shared key-format logic" note asks for.
const REAL_KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

describe('base64url codec', () => {
  it('round-trips arbitrary bytes (encode then decode returns the original)', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]); // includes bytes that map to +/ in std base64
    expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
  });

  it('emits no +, /, or = padding characters (RFC 4648 §5)', () => {
    // 0xFB 0xFF 0xBF standard-base64-encodes with both + and / present.
    const encoded = base64urlEncode(Buffer.from([0xfb, 0xff, 0xbf, 0xff, 0xef]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('signing-side / verify-side agreement (round-trip through a REAL issued key)', () => {
  it('decodes the real key payload to the expected fields', () => {
    const [p] = REAL_KEY.split('.');
    const payload = JSON.parse(base64urlDecode(p).toString('utf8'));
    expect(payload).toEqual({
      product: 'licenseproof',
      tier: 'individual',
      licenseId: 'E9YM3AUMWC',
      issuedAt: '2026-07-22T23:24:35.650Z',
      updatesUntil: '2027-07-22T23:24:35.650Z',
    });
  });

  it('re-encoding the decoded fields reproduces the exact P segment (TS encode == .mjs encode)', () => {
    const p = REAL_KEY.slice(0, REAL_KEY.lastIndexOf('.'));
    const fields = JSON.parse(base64urlDecode(p).toString('utf8'));
    // Independent TS re-implementation must yield the byte-identical P segment
    // the .mjs signing side produced — the cross-file contract proof.
    const reencoded = base64urlEncode(
      buildPayloadBytes({
        product: fields.product,
        tier: fields.tier,
        licenseId: fields.licenseId,
        issuedAt: fields.issuedAt,
        updatesUntil: fields.updatesUntil,
      }),
    );
    expect(reencoded).toBe(p);
  });

  it('buildPayloadBytes defaults product to the literal "licenseproof"', () => {
    const bytes = buildPayloadBytes({ tier: 'agency', licenseId: 'X', issuedAt: 'a', updatesUntil: 'b' });
    expect(JSON.parse(bytes.toString('utf8')).product).toBe(PRODUCT);
  });
});
