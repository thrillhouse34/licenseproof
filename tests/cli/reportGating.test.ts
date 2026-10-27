import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runReport } from '../../src/cli/report';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');
const NPM_FIXTURE = path.join(FIXTURES, 'package-lock-v3-basic');

// A real, genuine, verifying key (individual tier, updatesUntil 2027-07-22 — in
// the future relative to the installed 2026.07.x data, so it drives NO currency
// note). Lets the "unlocked" tests run on any machine without the private key.
const REAL_KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KEYGEN_MJS = path.resolve(REPO_ROOT, 'scripts', 'keygen', 'lib', 'keyFormat.mjs');
const PRIVATE_KEY_PATH = path.resolve(REPO_ROOT, '..', 'licenseproof-signing-key', 'signing-key');
const HAS_PRIVATE_KEY = fs.existsSync(PRIVATE_KEY_PATH);

/** Forge a real-signed key with an arbitrary updatesUntil (for the currency-note test). */
function forgeKeyWithUpdatesUntil(updatesUntil: string): string {
  const mjsUrl = pathToFileURL(KEYGEN_MJS).href;
  const script = `
    import * as crypto from 'crypto';
    import * as fs from 'fs';
    const m = await import(${JSON.stringify(mjsUrl)});
    const priv = crypto.createPrivateKey(fs.readFileSync(${JSON.stringify(PRIVATE_KEY_PATH)}, 'utf8'));
    const payload = m.buildPayloadBytes({
      tier: 'individual',
      licenseId: 'CURRTEST99',
      issuedAt: '2019-01-01T00:00:00.000Z',
      updatesUntil: ${JSON.stringify(updatesUntil)},
    });
    const sig = crypto.sign(null, payload, priv);
    process.stdout.write(m.base64urlEncode(payload) + '.' + m.base64urlEncode(sig));
  `;
  return execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

describe('runReport — gating (whole-request)', () => {
  let scratch: string;
  let noKeyFile: string;
  const HERMETIC = { env: {} as NodeJS.ProcessEnv };

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-gate-'));
    noKeyFile = path.join(scratch, 'no-such-license.key'); // guaranteed absent
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('refuses a gated format (html) with NO key: exit 3, price + URL in message, nothing written', async () => {
    const outDir = path.join(scratch, 'out');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: outDir,
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('$29');
    expect(result.output).toContain('$99');
    expect(result.output).toContain('https://licenseproof.dev');
    expect(fs.existsSync(outDir)).toBe(false); // nothing written
  });

  it('each gated format alone (pdf, notices, sbom-spdx) also refuses with exit 3', async () => {
    for (const fmt of ['pdf', 'notices', 'sbom-spdx']) {
      const result = await runReport({
        path: NPM_FIXTURE,
        productionOnly: true,
        formats: [fmt],
        out: path.join(scratch, fmt),
        keyFilePath: noKeyFile,
        ...HERMETIC,
      });
      expect(result.exitCode).toBe(3);
    }
  });

  it('a request with ONLY sbom-cyclonedx needs no key: exit 0, real file written', async () => {
    const target = path.join(scratch, 'sbom.cyclonedx.json');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['sbom-cyclonedx'],
      out: target,
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).bomFormat).toBe('CycloneDX');
  });

  it('repeated sbom-cyclonedx (still only the free format) needs no key: exit 0', async () => {
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['sbom-cyclonedx', 'sbom-cyclonedx'],
      out: path.join(scratch, 'repeat'),
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(0);
  });

  it('a MIXED request (html + sbom-cyclonedx) with no key refuses the WHOLE request: exit 3, nothing written (not even the free SBOM)', async () => {
    const outDir = path.join(scratch, 'mixed');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['sbom-cyclonedx', 'html'],
      out: outDir,
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(3);
    expect(fs.existsSync(outDir)).toBe(false); // the free cyclonedx was NOT partially written
  });

  it('unlocks a gated format with a valid --key: exit 0, artifact written', async () => {
    const target = path.join(scratch, 'report.html');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: target,
      key: REAL_KEY,
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('unlocks via the LICENSEPROOF_KEY env var when no --key is passed', async () => {
    const target = path.join(scratch, 'via-env.html');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: target,
      env: { LICENSEPROOF_KEY: REAL_KEY },
      keyFilePath: noKeyFile,
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('unlocks via the activated key file when neither --key nor env is present', async () => {
    const activated = path.join(scratch, 'license.key');
    fs.writeFileSync(activated, REAL_KEY);
    const target = path.join(scratch, 'via-file.html');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: target,
      keyFilePath: activated,
      env: {},
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('an invalid --key (garbage) is treated as no key: exit 3', async () => {
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: path.join(scratch, 'bad'),
      key: 'not-a-real-key.garbage',
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(3);
  });

  it('a valid future-dated key produces NO data-currency note (data within window)', async () => {
    const target = path.join(scratch, 'nonote.html');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: target,
      key: REAL_KEY, // updatesUntil 2027-07-22, after the installed 2026.07.x data
      keyFilePath: noKeyFile,
      ...HERMETIC,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output.toLowerCase()).not.toContain('newer reference data');
  });
});

// The data-currency note only fires with a real-signed key whose updatesUntil is
// in the past — forged via the .mjs override + the real private key.
describe.skipIf(!HAS_PRIVATE_KEY)('runReport — data-currency note (real signed key, past updatesUntil)', () => {
  let scratch: string;
  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-curr-'));
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('appends ONE informational note when installed data postdates the key window', async () => {
    const oldKey = forgeKeyWithUpdatesUntil('2020-01-01T00:00:00.000Z');
    const target = path.join(scratch, 'note.html');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html'],
      out: target,
      key: oldKey,
      env: {},
      keyFilePath: path.join(scratch, 'absent.key'),
    });
    expect(result.exitCode).toBe(0); // generation is completely unaffected
    expect(fs.existsSync(target)).toBe(true);
    expect(result.output.toLowerCase()).toContain('newer reference data');
    expect(result.output).toContain('2020-01-01');
    // Informational, not a warning.
    expect(result.output.toLowerCase()).not.toMatch(/warning|expired|error/);
  });
});
