import { describe, it, expect } from 'vitest';
import { resolveLicenseForPackage } from '../../src/resolve/licenseResolver';
import type { ScannedPackage } from '../../src/ecosystems/types';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../../src/paths';

const MIT_TEXT = fs.readFileSync(path.join(DATA_DIR, 'license-texts', 'MIT.txt'), 'utf8');

function makePkg(overrides: Partial<ScannedPackage>): ScannedPackage {
  return {
    name: 'test-pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['test-pkg']], pathCountAtLeast: 1, installPath: 'node_modules/test-pkg',
    ...overrides,
  };
}

describe('resolveLicenseForPackage', () => {
  it('resolves from declared metadata (single id) at high confidence, source "metadata"', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'MIT' }), undefined, undefined, 'proprietary');
    expect(result.license).toBe('MIT');
    expect(result.source).toBe('metadata');
    expect(result.confidence).toBe('high');
    expect(result.category).toBe('permissive');
    expect(result.conflict.level).toBe('NONE');
  });

  it('normalizes a deprecated id and records normalizedFrom', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'GPL-3.0' }), undefined, undefined, 'proprietary');
    expect(result.license).toBe('GPL-3.0-only');
    expect(result.normalizedFrom).toBe('GPL-3.0');
    expect(result.category).toBe('strong-copyleft');
    expect(result.conflict.level).toBe('CONFLICT');
  });

  it('parses a dual-license OR expression, source "expression", category from the most permissive branch', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'MIT OR GPL-3.0-only' }), undefined, undefined, 'proprietary');
    expect(result.source).toBe('expression');
    expect(result.licenseIds.sort()).toEqual(['GPL-3.0-only', 'MIT']);
    expect(result.category).toBe('permissive');
    expect(result.conflict.level).toBe('NONE'); // most-permissive branch (MIT) is conflict-free
  });

  it('falls through a malformed/non-SPDX licenseRaw ("UNLICENSED") to the next step instead of erroring', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'UNLICENSED' }), MIT_TEXT, undefined, 'proprietary');
    expect(result.source).toBe('license-file');
    expect(result.license).toBe('MIT');
  });

  it('falls back to LICENSE file fingerprinting when licenseRaw is absent', () => {
    const result = resolveLicenseForPackage(makePkg({}), MIT_TEXT, undefined, 'proprietary');
    expect(result.source).toBe('license-file');
    expect(result.license).toBe('MIT');
    expect(result.confidence).toBe('medium');
  });

  it('falls back to README scan as a last resort, at low confidence', () => {
    const readme = 'Some project\n\nLicense: MIT\n\nMore text...';
    const result = resolveLicenseForPackage(makePkg({}), undefined, readme, 'proprietary');
    expect(result.source).toBe('readme');
    expect(result.license).toBe('MIT');
    expect(result.confidence).toBe('low');
  });

  it('resolves to UNKNOWN, source "none", when nothing is available — never throws', () => {
    const result = resolveLicenseForPackage(makePkg({}), undefined, undefined, 'proprietary');
    expect(result.license).toBe('UNKNOWN');
    expect(result.source).toBe('none');
    expect(result.category).toBe('unknown');
    expect(result.conflict.level).toBe('REVIEW');
  });

  it('licenseRaw undefined is treated as "not yet resolved", never a signal — falls straight through', () => {
    const withoutMetadata = resolveLicenseForPackage(makePkg({ licenseRaw: undefined }), undefined, undefined, 'proprietary');
    expect(withoutMetadata.source).toBe('none');
  });

  it('categorizes a 3-way OR by the most-permissive branch even when that branch has multiple ids', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'MIT OR Apache-2.0 OR GPL-3.0-only' }), undefined, undefined, 'proprietary');
    expect(result.category).toBe('permissive');
    expect(result.conflict.level).toBe('NONE');
    expect(result.licenseIds.sort()).toEqual(['Apache-2.0', 'GPL-3.0-only', 'MIT']);
  });

  it('categorizes an OR-of-AND by the most-permissive branch when that branch is a multi-id AND', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: '(MIT AND ISC) OR GPL-3.0-only' }), undefined, undefined, 'proprietary');
    expect(result.category).toBe('permissive');
    expect(result.conflict.level).toBe('NONE');
  });

  it('preserves the full WITH expression in plain metadata, and labels it source:expression', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'GPL-2.0-only WITH Classpath-exception-2.0' }), undefined, undefined, 'proprietary');
    expect(result.license).toBe('GPL-2.0-only WITH Classpath-exception-2.0');
    expect(result.source).toBe('expression');
    expect(result.category).toBe('strong-copyleft');
  });

  it('preserves a WITH clause nested inside an OR branch', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'MIT OR (GPL-2.0-only WITH Classpath-exception-2.0)' }), undefined, undefined, 'proprietary');
    expect(result.license).toBe('MIT OR (GPL-2.0-only WITH Classpath-exception-2.0)');
    expect(result.source).toBe('expression');
    expect(result.category).toBe('permissive'); // MIT branch is fully permissive and chosen
  });

  it('normalizes a deprecated id inside a WITH clause and still records normalizedFrom', () => {
    const result = resolveLicenseForPackage(makePkg({ licenseRaw: 'GPL-3.0 WITH Classpath-exception-2.0' }), undefined, undefined, 'proprietary');
    expect(result.license).toBe('GPL-3.0 WITH Classpath-exception-2.0'); // raw expression display is unchanged by normalization
    expect(result.normalizedFrom).toBe('GPL-3.0'); // but normalization is still recorded
    expect(result.licenseIds).toEqual(['GPL-3.0-only']); // and the resolved id list uses the normalized form
    expect(result.category).toBe('strong-copyleft');
  });
});

function makePyPkg(overrides: Partial<ScannedPackage> = {}): ScannedPackage {
  return {
    name: 'py-pkg', version: '1.0.0', ecosystem: 'pypi', direct: true, dev: false,
    paths: [['py-pkg']], pathCountAtLeast: 1, installPath: 'py_pkg-1.0.0.dist-info',
    ...overrides,
  };
}

describe('resolveLicenseForPackage — PyPI branch (ecosystem: pypi)', () => {
  it('prefers License-Expression over a disagreeing classifier; source "expression", REVIEW-level disagreement note', () => {
    const result = resolveLicenseForPackage(makePyPkg(), undefined, undefined, 'proprietary', {
      licenseExpression: 'MIT',
      license: undefined,
      classifiers: ['License :: OSI Approved :: Apache Software License'],
    });
    expect(result.source).toBe('expression');
    expect(result.license).toBe('MIT');
    expect(result.conflict.level).toBe('REVIEW');
    expect(result.conflict.explanationKey).toBe('pypi-metadata-classifier-disagreement');
  });

  it('no disagreement bump when License-Expression id is one branch of the classifier-covered set', () => {
    const result = resolveLicenseForPackage(makePyPkg(), undefined, undefined, 'proprietary', {
      licenseExpression: 'MIT OR Apache-2.0',
      license: undefined,
      classifiers: ['License :: OSI Approved :: Apache Software License'], // Apache-2.0 is in the expression's id set
    });
    expect(result.source).toBe('expression');
    expect(result.conflict.level).toBe('NONE');
    expect(result.conflict.explanationKey).toBeNull();
  });

  it('treats a "UNKNOWN" License field as a non-license placeholder and falls through to the classifier', () => {
    const result = resolveLicenseForPackage(makePyPkg(), undefined, undefined, 'proprietary', {
      licenseExpression: undefined,
      license: 'UNKNOWN',
      classifiers: ['License :: OSI Approved :: MIT License'],
    });
    expect(result.source).toBe('classifier');
    expect(result.license).toBe('MIT');
    expect(result.conflict.level).toBe('NONE'); // only one signal resolved — no disagreement
  });

  it('falls through metadata (none present) to fingerprint the on-disk LICENSE FILE text, never a metadata string', () => {
    // Metadata absent entirely; only the license FILE text is available. This
    // proves fingerprinting receives file contents, not any metadata field.
    const result = resolveLicenseForPackage(makePyPkg(), MIT_TEXT, undefined, 'proprietary', {
      licenseExpression: undefined,
      license: undefined,
      classifiers: [],
    });
    expect(result.source).toBe('license-file');
    expect(result.license).toBe('MIT');
  });

  it('a free-text License field ("Apache 2.0") does NOT get fingerprinted as a string; it falls through to the classifier', () => {
    const result = resolveLicenseForPackage(makePyPkg(), undefined, undefined, 'proprietary', {
      licenseExpression: undefined,
      license: 'Apache 2.0', // free text — unparseable as SPDX, must not reach the fingerprint step as a string
      classifiers: ['License :: OSI Approved :: Apache Software License'],
    });
    expect(result.source).toBe('classifier');
    expect(result.license).toBe('Apache-2.0');
  });

  it('resolves to UNKNOWN/none when a PyPI package has no metadata, license file, or readme', () => {
    const result = resolveLicenseForPackage(makePyPkg(), undefined, undefined, 'proprietary', undefined);
    expect(result.source).toBe('none');
    expect(result.license).toBe('UNKNOWN');
    expect(result.conflict.level).toBe('REVIEW'); // unknown -> REVIEW
  });
});
