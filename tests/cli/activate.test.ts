import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runActivate } from '../../src/cli/activate';

const REAL_KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

describe('runActivate', () => {
  let scratch: string;
  let keyFile: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-activate-'));
    keyFile = path.join(scratch, 'nested', 'licenseproof', 'license.key');
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('stores a valid key, names the tier, confirms unlock, exit 0, creates the dir tree', () => {
    const result = runActivate(REAL_KEY, { keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('individual'); // names the tier
    expect(result.output.toLowerCase()).toContain('unlock');
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.readFileSync(keyFile, 'utf8')).toBe(REAL_KEY);
  });

  it('trims surrounding whitespace before storing (stores the clean key)', () => {
    const result = runActivate(`  ${REAL_KEY}\n`, { keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(keyFile, 'utf8')).toBe(REAL_KEY);
  });

  it('rejects an empty key with exit 2, writes nothing', () => {
    const result = runActivate('   ', { keyFilePath: keyFile });
    expect(result.exitCode).toBe(2);
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('rejects a malformed key (no separator) with a format-specific message, exit 2, nothing written', () => {
    const result = runActivate('this-is-not-a-key', { keyFilePath: keyFile });
    expect(result.exitCode).toBe(2);
    expect(result.output.toLowerCase()).toContain('does not look like a license key');
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('rejects a tampered key (bad signature) with the generic verification message, exit 2, nothing written', () => {
    const lastDot = REAL_KEY.lastIndexOf('.');
    const s = REAL_KEY.slice(lastDot + 1);
    const tampered = REAL_KEY.slice(0, lastDot + 1) + (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const result = runActivate(tampered, { keyFilePath: keyFile });
    expect(result.exitCode).toBe(2);
    expect(result.output.toLowerCase()).toContain('could not be verified');
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('does not overwrite/ create the file on any failure', () => {
    runActivate('garbage.garbage', { keyFilePath: keyFile });
    expect(fs.existsSync(keyFile)).toBe(false);
  });
});
