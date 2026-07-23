import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDeactivate } from '../../src/cli/deactivate';

describe('runDeactivate', () => {
  let scratch: string;
  let keyFile: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-deactivate-'));
    keyFile = path.join(scratch, 'license.key');
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('removes an existing key file, confirms, exit 0', () => {
    fs.writeFileSync(keyFile, 'SOME_KEY');
    const result = runDeactivate({ keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(result.output.toLowerCase()).toContain('deactivated');
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('is idempotent: no error when the file is already absent, exit 0', () => {
    const result = runDeactivate({ keyFilePath: keyFile });
    expect(result.exitCode).toBe(0);
    expect(result.output.toLowerCase()).toContain('no active license');
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('running twice in a row both exit 0 (second is the idempotent no-op)', () => {
    fs.writeFileSync(keyFile, 'SOME_KEY');
    expect(runDeactivate({ keyFilePath: keyFile }).exitCode).toBe(0);
    expect(runDeactivate({ keyFilePath: keyFile }).exitCode).toBe(0);
  });
});
