import { describe, it, expect } from 'vitest';
import { buildJsonReport } from '../../src/report/json';
import type { ResolvedPackage } from '../../src/resolve/types';

function makeResolved(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg', diskPath: 'node_modules/pkg',
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

describe('buildJsonReport', () => {
  it('includes schemaVersion 1 and all required metadata fields', () => {
    const report = buildJsonReport({
      projectName: 'my-app', packages: [], warnings: [],
      projectLicense: { id: 'MIT', wasUnspecified: false },
      toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z',
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.toolVersion).toBe('0.1.0');
    expect(report.dataVersion).toBe('2026.07.21');
    expect(report.scanTimestamp).toBe('2026-07-21T00:00:00.000Z');
    expect(report.projectLicense).toEqual({ id: 'MIT', wasUnspecified: false });
  });

  it('exposes diskPath as a boolean presence flag, never the raw path', () => {
    const withDisk = makeResolved({ diskPath: 'node_modules/pkg' });
    const withoutDisk = makeResolved({ name: 'other', diskPath: undefined });
    const report = buildJsonReport({ projectName: 'x', packages: [withDisk, withoutDisk], warnings: [], projectLicense: { id: 'MIT', wasUnspecified: false }, toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z' });
    expect(report.packages.find((p) => p.name === 'pkg')!.hasDiskPath).toBe(true);
    expect(report.packages.find((p) => p.name === 'other')!.hasDiskPath).toBe(false);
    expect(JSON.stringify(report)).not.toContain('node_modules/pkg'); // the raw path string must never appear
  });

  it('sorts packages by severity then name, deterministically', () => {
    const conflictB = makeResolved({ name: 'b-conflict', conflict: { level: 'CONFLICT', explanationKey: 'x', agplNetworkedUse: false } });
    const conflictA = makeResolved({ name: 'a-conflict', conflict: { level: 'CONFLICT', explanationKey: 'x', agplNetworkedUse: false } });
    const clean = makeResolved({ name: 'z-clean' });
    const report = buildJsonReport({ projectName: 'x', packages: [clean, conflictB, conflictA], warnings: [], projectLicense: { id: 'MIT', wasUnspecified: false }, toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z' });
    expect(report.packages.map((p) => p.name)).toEqual(['a-conflict', 'b-conflict', 'z-clean']);
  });

  it('computes summary counts correctly', () => {
    const conflict = makeResolved({ name: 'a', conflict: { level: 'CONFLICT', explanationKey: 'x', agplNetworkedUse: false } });
    const review = makeResolved({ name: 'b', category: 'weak-copyleft', conflict: { level: 'REVIEW', explanationKey: 'x', agplNetworkedUse: false } });
    const unknown = makeResolved({ name: 'c', category: 'unknown', source: 'none', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } });
    const agpl = makeResolved({ name: 'd', conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true } });
    const report = buildJsonReport({ projectName: 'x', packages: [conflict, review, unknown, agpl], warnings: [], projectLicense: { id: 'MIT', wasUnspecified: false }, toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z' });
    expect(report.summary.totalPackages).toBe(4);
    expect(report.summary.conflictCount).toBe(1);
    expect(report.summary.reviewCount).toBe(1);
    expect(report.summary.unknownCount).toBe(1);
    expect(report.summary.agplCount).toBe(1);
  });

  it('diverges agplCount and agplInformationalCount correctly', () => {
    // Informational case: AGPL present only as a non-chosen OR branch, e.g.
    // "MIT OR AGPL-3.0-only" resolved to the MIT branch — conflict.level is
    // NONE, nothing blocked.
    const agplInformational = makeResolved({
      name: 'agpl-or-mit',
      license: 'MIT OR AGPL-3.0-only',
      licenseIds: ['MIT', 'AGPL-3.0-only'],
      conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true },
    });
    // Blocking case: bare AGPL, conflict.level is CONFLICT.
    const agplConflict = makeResolved({
      name: 'bare-agpl',
      license: 'AGPL-3.0-only',
      licenseIds: ['AGPL-3.0-only'],
      category: 'strong-copyleft',
      conflict: { level: 'CONFLICT', explanationKey: 'agpl-conflict', agplNetworkedUse: true },
    });
    const report = buildJsonReport({
      projectName: 'x', packages: [agplInformational, agplConflict], warnings: [],
      projectLicense: { id: 'MIT', wasUnspecified: false },
      toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z',
    });
    // Both packages have agplNetworkedUse: true, regardless of conflict.level.
    expect(report.summary.agplCount).toBe(2);
    // Only the non-blocking, non-chosen-branch package counts as informational.
    expect(report.summary.agplInformationalCount).toBe(1);
  });

  it('reports per-ecosystem package counts in summary.byEcosystem (Milestone 4), summing to totalPackages', () => {
    const packages = [
      makeResolved({ name: 'express', ecosystem: 'npm' }),
      makeResolved({ name: 'body-parser', ecosystem: 'npm' }),
      makeResolved({ name: 'requests', ecosystem: 'pypi', installPath: 'requests-2.31.0.dist-info', diskPath: undefined, source: 'none', license: 'UNKNOWN', category: 'unknown', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } }),
    ];
    const report = buildJsonReport({
      projectName: 'mixed', packages, warnings: [],
      projectLicense: { id: 'MIT', wasUnspecified: false },
      toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z',
    });
    expect(report.summary.byEcosystem).toEqual({ npm: 2, pypi: 1 });
    const sum = Object.values(report.summary.byEcosystem).reduce((a, b) => a + b, 0);
    expect(sum).toBe(report.summary.totalPackages);
  });

  it('byEcosystem has a single key on a single-ecosystem scan', () => {
    const report = buildJsonReport({
      projectName: 'npm-only', packages: [makeResolved({ name: 'a' }), makeResolved({ name: 'b' })], warnings: [],
      projectLicense: { id: 'MIT', wasUnspecified: false },
      toolVersion: '0.1.0', dataVersion: '2026.07.21', scanTimestamp: '2026-07-21T00:00:00.000Z',
    });
    expect(report.summary.byEcosystem).toEqual({ npm: 2 });
  });
});
