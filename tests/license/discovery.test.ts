import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverLicenseKey } from '../../src/license/discovery';

describe('discoverLicenseKey — precedence: --key > env > file', () => {
  let scratch: string;
  let keyFile: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-discovery-'));
    keyFile = path.join(scratch, 'license.key');
    fs.writeFileSync(keyFile, 'FILE_KEY_VALUE\n');
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('the --key CLI value wins when all three sources are set to different values', () => {
    const resolved = discoverLicenseKey({
      cliKey: 'CLI_KEY_VALUE',
      env: { LICENSEPROOF_KEY: 'ENV_KEY_VALUE' },
      keyFilePath: keyFile,
    });
    expect(resolved).toBe('CLI_KEY_VALUE');
  });

  it('the env var wins over the file when no --key is passed', () => {
    const resolved = discoverLicenseKey({
      cliKey: undefined,
      env: { LICENSEPROOF_KEY: 'ENV_KEY_VALUE' },
      keyFilePath: keyFile,
    });
    expect(resolved).toBe('ENV_KEY_VALUE');
  });

  it('the file value is used when neither --key nor env is set (and is trimmed)', () => {
    const resolved = discoverLicenseKey({ cliKey: undefined, env: {}, keyFilePath: keyFile });
    expect(resolved).toBe('FILE_KEY_VALUE');
  });

  it('returns undefined when no source has a key', () => {
    const resolved = discoverLicenseKey({
      cliKey: undefined,
      env: {},
      keyFilePath: path.join(scratch, 'does-not-exist.key'),
    });
    expect(resolved).toBeUndefined();
  });

  it('treats an empty/whitespace --key and empty env as absent, falling through to the file', () => {
    const resolved = discoverLicenseKey({
      cliKey: '   ',
      env: { LICENSEPROOF_KEY: '' },
      keyFilePath: keyFile,
    });
    expect(resolved).toBe('FILE_KEY_VALUE');
  });
});
