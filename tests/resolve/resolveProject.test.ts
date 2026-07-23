import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveProject } from '../../src/resolve/resolveProject';
import type { ScanResult } from '../../src/ecosystems/types';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

function makeScanResult(overrides: Partial<ScanResult>): ScanResult {
  return { projectName: 'test', ecosystems: ['npm'], lockfile: 'package-lock', packages: [], warnings: [], ...overrides };
}

describe('resolveProject', () => {
  it('reads a real LICENSE file via diskPath and resolves it', async () => {
    const scanResult = makeScanResult({
      packages: [{
        name: 'left-pad', version: '1.3.0', ecosystem: 'npm', direct: true, dev: false,
        paths: [['left-pad']], pathCountAtLeast: 1,
        installPath: 'node_modules/left-pad', diskPath: 'node_modules/left-pad', licenseRaw: 'MIT',
      }],
    });
    const { packages: resolved, dataVersion } = resolveProject(path.join(FIXTURES, 'package-lock-optional-not-installed'), scanResult, 'proprietary');
    expect(resolved[0].source).toBe('metadata'); // licenseRaw wins before any disk read is even needed
    expect(dataVersion).toBe('2026.07.21.2');
  });

  it('skips disk-based steps entirely when diskPath is undefined — never throws, never guesses a path', () => {
    const scanResult = makeScanResult({
      packages: [{
        name: 'phantom-pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
        paths: [['phantom-pkg']], pathCountAtLeast: 1,
        installPath: 'node_modules/phantom-pkg', diskPath: undefined,
      }],
    });
    expect(() => resolveProject('/nonexistent/path/that/does/not/exist', scanResult, 'proprietary')).not.toThrow();
    const { packages: resolved } = resolveProject('/nonexistent/path/that/does/not/exist', scanResult, 'proprietary');
    expect(resolved[0].source).toBe('none');
    expect(resolved[0].license).toBe('UNKNOWN');
  });

  it('blocks a SEE LICENSE IN reference that escapes the package directory, records UNKNOWN, never exposes the path', () => {
    const scanResult = makeScanResult({
      packages: [{
        name: 'escaping-pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
        paths: [['escaping-pkg']], pathCountAtLeast: 1,
        installPath: 'node_modules/escaping-pkg', diskPath: 'node_modules/escaping-pkg',
        licenseRaw: 'SEE LICENSE IN ../../../../../../../../etc/passwd',
      }],
    });
    const { packages } = resolveProject(path.join(FIXTURES, 'resolve-10-see-license-in-escape'), scanResult, 'proprietary');
    const pkg = packages[0];
    expect(pkg.source).toBe('none');
    expect(pkg.license).toBe('UNKNOWN');
    expect(JSON.stringify(pkg)).not.toContain('/etc/passwd');
  });
});
