import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runActivate } from '../../src/cli/activate';
import { runDeactivate } from '../../src/cli/deactivate';
import { runReport } from '../../src/cli/report';
import { findChromeExecutable } from '../../src/report/pdf';

// ─────────────────────────────────────────────────────────────────────────────
// THE FULL SIMULATED CUSTOMER JOURNEY (Milestone 6 Definition of Done).
//
// The individual pieces of this flow are already unit/integration tested in
// tests/cli/activate.test.ts, tests/cli/deactivate.test.ts, and
// tests/cli/reportGating.test.ts. This file is the ONE cohesive test that chains
// them into the real end-to-end journey the milestone brief calls for:
//
//   issue key → activate → generate a gated report (works) → deactivate →
//   gated report refused with the friendly message + exit 3, nothing written →
//   sbom-cyclonedx still works keyless (exit 0, real file).
//
// It runs as a tightly-sequenced handful of steps sharing one scratch dir, so a
// failure pinpoints exactly which leg of the journey broke. Every filesystem
// touch is inside an injected tmpdir keyFilePath / out path — the machine's real
// ~/.config/licenseproof/license.key is NEVER read or written (same isolation
// approach as the three unit suites above).
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NPM_FIXTURE = path.join(REPO_ROOT, 'fixtures', 'package-lock-v3-basic');
const KEYGEN_MJS = path.resolve(REPO_ROOT, 'scripts', 'keygen', 'lib', 'keyFormat.mjs');
const PRIVATE_KEY_PATH = path.resolve(REPO_ROOT, '..', 'licenseproof-signing-key', 'signing-key');
// A fresh real issuance needs BOTH halves of the signing side: the private key
// AND the keygen wire-format module. The public mirror intentionally ships no
// scripts/keygen/, so there we fall back to the committed real-signed key and
// the journey still runs end to end.
const CAN_ISSUE = fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(KEYGEN_MJS);

// The gated artifact this journey generates. PDF is the brief's literal wording
// ("generate PDF"), and it's what we exercise on any machine with a real browser
// (Chrome/Chromium/Edge). With no browser installed — a bare CI box — the PDF
// renderer can't run, so we fall back to HTML: still a gated (paid) format, so
// the license journey is exercised identically; only the on-disk artifact type
// differs. Either way the full gate is proven end-to-end.
const HAS_BROWSER = findChromeExecutable() !== undefined;
const GATED_FORMAT: 'pdf' | 'html' = HAS_BROWSER ? 'pdf' : 'html';
const GATED_FILENAME = GATED_FORMAT === 'pdf' ? 'report.pdf' : 'report.html';

// A real, genuine, verifying individual-tier key with an updatesUntil in the
// future (so it drives NO data-currency note). When the private signing key is
// present on this machine we ISSUE a fresh one for real via the keygen wire
// format (`scripts/keygen/lib/keyFormat.mjs` — the same mechanism the keygen
// tooling and reportGating's forge helper use). Otherwise we fall back to this
// committed real-signed key so the journey still runs without the private key
// or without scripts/keygen/ — exactly the pattern reportGating.test.ts uses.
const FALLBACK_REAL_KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

/**
 * Step 1 of the journey — issue a real, verifying individual-tier license key.
 * Signs a fresh payload with the real private key when it and the keygen module
 * are both available (a genuine issuance), else returns the committed
 * real-signed key. Uses a future
 * updatesUntil so the generated report carries no data-currency FYI line.
 */
function issueRealKey(): string {
  if (!CAN_ISSUE) return FALLBACK_REAL_KEY;
  const mjsUrl = pathToFileURL(KEYGEN_MJS).href;
  const script = `
    import * as crypto from 'crypto';
    import * as fs from 'fs';
    const m = await import(${JSON.stringify(mjsUrl)});
    const priv = crypto.createPrivateKey(fs.readFileSync(${JSON.stringify(PRIVATE_KEY_PATH)}, 'utf8'));
    const payload = m.buildPayloadBytes({
      tier: 'individual',
      licenseId: 'JOURNEYTST',
      issuedAt: new Date().toISOString(),
      updatesUntil: '2099-01-01T00:00:00.000Z',
    });
    const sig = crypto.sign(null, payload, priv);
    process.stdout.write(m.base64urlEncode(payload) + '.' + m.base64urlEncode(sig));
  `;
  return execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim();
}

describe('full simulated customer journey (issue → activate → report → deactivate → refused → free SBOM)', () => {
  let scratch: string;
  let keyFile: string; // the activated-license location (injected, never ~/.config)
  let issuedKey: string;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-journey-'));
    // Mirror activate.test.ts: a nested path that must be created by activate.
    keyFile = path.join(scratch, 'config', 'licenseproof', 'license.key');
    // STEP 1 — issue a real key.
    issuedKey = issueRealKey();
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('step 1: issues a real, well-formed license key', () => {
    expect(issuedKey).toBeTruthy();
    expect(issuedKey).toContain('.'); // P.S wire format
    expect(fs.existsSync(keyFile)).toBe(false); // not activated yet
  });

  it('step 2: activates the key — exit 0, names the tier, writes the license file', () => {
    const result = runActivate(issuedKey, { keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('individual');
    expect(result.output.toLowerCase()).toContain('unlock');
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.readFileSync(keyFile, 'utf8')).toBe(issuedKey);
  });

  it(`step 3: generates a gated ${GATED_FORMAT.toUpperCase()} report using the activated key — exit 0, real non-trivial file written`, async () => {
    const target = path.join(scratch, GATED_FILENAME);
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: [GATED_FORMAT],
      out: target,
      keyFilePath: keyFile, // resolves the key from the activated file
      env: {}, // no --key, no LICENSEPROOF_KEY: the FILE must be what unlocks it
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    const bytes = fs.readFileSync(target);
    expect(bytes.length).toBeGreaterThan(1000); // a real artifact, not an empty stub
    if (GATED_FORMAT === 'pdf') {
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-'); // genuine PDF
    } else {
      expect(bytes.toString('utf8').toLowerCase()).toContain('<!doctype html>');
    }
    // A key within its update window drives no data-currency note.
    expect(result.output.toLowerCase()).not.toContain('newer reference data');
  });

  it('step 4: deactivates — exit 0, confirms, removes the license file', () => {
    const result = runDeactivate({ keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(result.output.toLowerCase()).toContain('deactivated');
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it(`step 5: the SAME gated ${GATED_FORMAT.toUpperCase()} format is now refused — no key anywhere: exit 3, friendly $29/$99/URL message, NOTHING written`, async () => {
    // Prove there is genuinely no key from any source: no --key, empty env
    // (no LICENSEPROOF_KEY), and the license file is gone (step 4 removed it).
    expect(fs.existsSync(keyFile)).toBe(false);
    const target = path.join(scratch, 'refused', GATED_FILENAME);
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: [GATED_FORMAT],
      out: target,
      keyFilePath: keyFile, // absent → no key from the file source
      env: {}, // no LICENSEPROOF_KEY
      // no `key` → no CLI key
    });
    expect(result.exitCode).toBe(3); // EXIT_UNLICENSED
    expect(result.output).toContain('$29');
    expect(result.output).toContain('$99');
    expect(result.output).toContain('https://licenseproof.dev');
    expect(fs.existsSync(target)).toBe(false); // refusal wrote nothing
    expect(fs.existsSync(path.dirname(target))).toBe(false); // not even the dir
  });

  it('step 6: sbom-cyclonedx still works with no key — exit 0, real valid CycloneDX file written', async () => {
    expect(fs.existsSync(keyFile)).toBe(false); // still keyless
    const target = path.join(scratch, 'sbom.cyclonedx.json');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['sbom-cyclonedx'],
      out: target,
      keyFilePath: keyFile, // absent
      env: {},
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    const sbom = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(sbom.bomFormat).toBe('CycloneDX'); // proves the free format needs no key
  });
});
