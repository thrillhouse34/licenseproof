import { describe, it, expect } from 'vitest';
import { classifySeverity } from '../../src/report/severity';
import type { ResolvedPackage } from '../../src/resolve/types';

function makeResolved(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg',
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

describe('classifySeverity', () => {
  it('conflict beats everything', () => {
    expect(classifySeverity(makeResolved({ conflict: { level: 'CONFLICT', explanationKey: 'x', agplNetworkedUse: false } }))).toBe('conflict');
  });
  it('unknown category is its own bucket even though it also carries REVIEW level', () => {
    expect(classifySeverity(makeResolved({ category: 'unknown', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } }))).toBe('unknown');
  });
  it('review (non-unknown) is its own bucket', () => {
    expect(classifySeverity(makeResolved({ category: 'weak-copyleft', conflict: { level: 'REVIEW', explanationKey: 'weak-copyleft-review', agplNetworkedUse: false } }))).toBe('review');
  });
  it('AGPL present only as a non-chosen alternative, chosen branch clean -> agpl-informational, not conflict', () => {
    expect(classifySeverity(makeResolved({ conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true } }))).toBe('agpl-informational');
  });
  it('a genuinely clean package with no flags at all', () => {
    expect(classifySeverity(makeResolved({}))).toBe('clean');
  });
});
