import { describe, it, expect } from 'vitest';
import { toPurl } from '../../src/report/sbom/purl';
import type { ResolvedPackage } from '../../src/resolve/types';

function pkg(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg', diskPath: 'node_modules/pkg',
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

describe('toPurl', () => {
  it('builds an unscoped npm purl', () => {
    expect(toPurl(pkg({ ecosystem: 'npm', name: 'left-pad', version: '1.3.0' }))).toBe('pkg:npm/left-pad@1.3.0');
  });

  it('percent-encodes the @ of a SCOPED npm package as %40, keeping the / literal', () => {
    // The single easiest-to-get-wrong case, per the purl-spec's own worked
    // example (pkg:npm/%40angular/animation@12.3.1).
    expect(toPurl(pkg({ ecosystem: 'npm', name: '@babel/core', version: '7.24.0' }))).toBe(
      'pkg:npm/%40babel/core@7.24.0',
    );
  });

  it('does not lowercase a mixed-case npm name (npm names are case-sensitive in purl)', () => {
    expect(toPurl(pkg({ ecosystem: 'npm', name: 'JSONStream', version: '1.3.5' }))).toBe('pkg:npm/JSONStream@1.3.5');
    expect(toPurl(pkg({ ecosystem: 'npm', name: '@MyOrg/Thing', version: '2.0.0' }))).toBe(
      'pkg:npm/%40MyOrg/Thing@2.0.0',
    );
  });

  it('lowercases a pypi name and replaces underscores with dashes', () => {
    expect(toPurl(pkg({ ecosystem: 'pypi', name: 'Django', version: '4.2.0' }))).toBe('pkg:pypi/django@4.2.0');
    expect(toPurl(pkg({ ecosystem: 'pypi', name: 'typing_extensions', version: '4.9.0' }))).toBe(
      'pkg:pypi/typing-extensions@4.9.0',
    );
    expect(toPurl(pkg({ ecosystem: 'pypi', name: 'Flask_Cors', version: '4.0.0' }))).toBe('pkg:pypi/flask-cors@4.0.0');
  });
});
