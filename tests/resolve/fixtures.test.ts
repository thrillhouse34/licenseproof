import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { npmEcosystem } from '../../src/ecosystems/npm';
import { resolveProject } from '../../src/resolve/resolveProject';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

async function scanAndResolve(fixtureName: string, projectLicenseId: string) {
  const dir = path.join(FIXTURES, fixtureName);
  const scanResult = await npmEcosystem.scan(dir, { productionOnly: true });
  return resolveProject(dir, scanResult, projectLicenseId).packages;
}

describe('spec §6 fixtures 1-8, wired through the real pipeline end-to-end', () => {
  it('01: dual license OR (with a deprecated id in one branch) resolves both branches, category from the most permissive', async () => {
    const resolved = await scanAndResolve('resolve-01-dual-license', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'dual-licensed-pkg')!;
    expect(pkg.licenseIds.sort()).toEqual(['GPL-3.0-only', 'MIT']);
    expect(pkg.category).toBe('permissive');
    expect(pkg.conflict.level).toBe('NONE');
  });

  it('02: SEE LICENSE IN follows the referenced file and fingerprints it', async () => {
    const resolved = await scanAndResolve('resolve-02-see-license-in', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'custom-license-pkg')!;
    expect(pkg.source).toBe('license-file');
    expect(pkg.license).toBe('MIT');
  });

  it('03: missing license field resolves to UNKNOWN/none/REVIEW, never crashes', async () => {
    const resolved = await scanAndResolve('resolve-03-missing-license', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'mystery-pkg')!;
    expect(pkg.category).toBe('unknown');
    expect(pkg.source).toBe('none');
    expect(pkg.conflict.level).toBe('REVIEW');
  });

  it('04: deprecated SPDX id normalizes and is noted', async () => {
    const resolved = await scanAndResolve('resolve-04-deprecated-id', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'old-gpl-pkg')!;
    expect(pkg.license).toBe('GPL-3.0-only');
    expect(pkg.normalizedFrom).toBe('GPL-3.0');
    expect(pkg.conflict.level).toBe('CONFLICT');
  });

  it('05: modified license text resolves at low confidence with the "-like (modified)" label', async () => {
    const resolved = await scanAndResolve('resolve-05-modified-license-text', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'modified-mit-pkg')!;
    expect(pkg.source).toBe('license-file');
    expect(pkg.confidence).toBe('low');
    expect(pkg.license).toBe('MIT-like (modified)');
  });

  it('06: scoped package with UNLICENSED metadata falls through to fingerprint the real LICENSE file', async () => {
    const resolved = await scanAndResolve('resolve-06-scoped-private', 'proprietary');
    const pkg = resolved.find((p) => p.name === '@myorg/private-pkg')!;
    expect(pkg.source).toBe('license-file');
    expect(pkg.license).toBe('MIT');
  });

  it('07: AGPL gets its distinct prominent flag regardless of a permissive project license', async () => {
    const resolved = await scanAndResolve('resolve-07-agpl-project', 'MIT');
    const pkg = resolved.find((p) => p.name === 'agpl-pkg')!;
    expect(pkg.conflict.agplNetworkedUse).toBe(true);
    expect(pkg.conflict.level).toBe('CONFLICT');
  });

  it('08: a conflict matrix of three packages resolves each independently in one real pipeline run', async () => {
    const resolved = await scanAndResolve('resolve-08-conflict-matrix', 'proprietary');
    const strongCopyleft = resolved.find((p) => p.category === 'strong-copyleft')!;
    const noncommercial = resolved.find((p) => p.category === 'noncommercial')!;
    const permissive = resolved.find((p) => p.category === 'permissive')!;
    expect(strongCopyleft.conflict.level).toBe('CONFLICT');
    expect(noncommercial.conflict.level).toBe('CONFLICT');
    expect(permissive.conflict.level).toBe('NONE');
  });

  it('09: WITH exception is preserved end-to-end through the real pipeline, never collapsed to the bare base id', async () => {
    const resolved = await scanAndResolve('resolve-09-with-exception', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'classpath-licensed-pkg')!;
    expect(pkg.license).toBe('GPL-2.0-only WITH Classpath-exception-2.0');
    expect(pkg.source).toBe('expression');
  });

  it('10: SEE LICENSE IN containment escape resolves to UNKNOWN end-to-end, never reads or exposes the escaping path', async () => {
    const resolved = await scanAndResolve('resolve-10-see-license-in-escape', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'escaping-pkg')!;
    expect(pkg.source).toBe('none');
    expect(pkg.category).toBe('unknown');
    expect(JSON.stringify(pkg)).not.toContain('etc/passwd');
  });
});
