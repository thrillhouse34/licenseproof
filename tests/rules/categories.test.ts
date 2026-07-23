import { describe, it, expect } from 'vitest';
import { categorizeLicenseId, categorizeExpression, categorizeIds, sameLicenseFamily } from '../../src/rules/categories';
import { parseSpdxExpression } from '../../src/resolve/spdxParser';

function expr(raw: string) {
  const r = parseSpdxExpression(raw);
  if (!r.ok) throw new Error('test fixture expression must parse');
  return r.expr;
}

describe('categorizeLicenseId', () => {
  it('categorizes MIT as permissive, GPL-3.0-only as strong-copyleft, MPL-2.0 as weak-copyleft, Unlicense as public-domain, unknowns as unknown', () => {
    expect(categorizeLicenseId('MIT')).toBe('permissive');
    expect(categorizeLicenseId('GPL-3.0-only')).toBe('strong-copyleft');
    expect(categorizeLicenseId('MPL-2.0')).toBe('weak-copyleft');
    expect(categorizeLicenseId('Unlicense')).toBe('public-domain');
    expect(categorizeLicenseId('Some-Made-Up-License')).toBe('unknown');
  });
});

describe('categorizeExpression', () => {
  it('returns the riskiest category across an AND expression', () => {
    expect(categorizeExpression(expr('MIT AND GPL-3.0-only'))).toBe('strong-copyleft');
  });
  it('returns permissive when every OR branch is permissive', () => {
    expect(categorizeExpression(expr('MIT OR Apache-2.0'))).toBe('permissive');
  });
});

describe('categorizeIds', () => {
  it('categorizeIds applies riskiest-wins directly to a plain id list', () => {
    expect(categorizeIds(['MIT', 'Apache-2.0'])).toBe('permissive');
    expect(categorizeIds(['MIT', 'GPL-3.0-only'])).toBe('strong-copyleft');
  });
});

describe('sameLicenseFamily', () => {
  it('groups same-lineage variants (the classifier representative-mapping families)', () => {
    expect(sameLicenseFamily('BSD-2-Clause', 'BSD-3-Clause')).toBe(true);
    expect(sameLicenseFamily('GPL-2.0-only', 'GPL-3.0-only')).toBe(true);
    expect(sameLicenseFamily('LGPL-2.1-only', 'LGPL-3.0-only')).toBe(true);
    expect(sameLicenseFamily('Apache-1.1', 'Apache-2.0')).toBe(true);
    expect(sameLicenseFamily('Artistic-1.0', 'Artistic-2.0')).toBe(true);
    expect(sameLicenseFamily('AFL-2.1', 'AFL-3.0')).toBe(true);
  });

  it('does NOT group genuinely different licenses, even within one broad category', () => {
    // MIT vs Apache-2.0 are both permissive but different families — the exact case
    // that must still be treated as a real metadata-vs-classifier disagreement.
    expect(sameLicenseFamily('MIT', 'Apache-2.0')).toBe(false);
    expect(sameLicenseFamily('MIT', 'BSD-3-Clause')).toBe(false);
    // GPL / LGPL / AGPL are related but deliberately kept as separate families.
    expect(sameLicenseFamily('GPL-3.0-only', 'LGPL-3.0-only')).toBe(false);
    expect(sameLicenseFamily('GPL-3.0-only', 'AGPL-3.0-only')).toBe(false);
  });

  it('ids outside any known family never match — not even against themselves', () => {
    // Intentional: suppression only ever fires on true same-lineage variant ambiguity.
    expect(sameLicenseFamily('MIT', 'MIT')).toBe(false);
    expect(sameLicenseFamily('ISC', 'ISC')).toBe(false);
    expect(sameLicenseFamily('AGPL-3.0-only', 'AGPL-3.0-only')).toBe(false);
  });
});
