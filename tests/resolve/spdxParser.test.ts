import { describe, it, expect } from 'vitest';
import { parseSpdxExpression, flattenLicenseIds, mostPermissiveBranch } from '../../src/resolve/spdxParser';

describe('parseSpdxExpression', () => {
  it('parses a single license id (case-tolerant)', () => {
    expect(parseSpdxExpression('MIT')).toEqual({ ok: true, expr: { type: 'license', id: 'MIT' } });
    expect(parseSpdxExpression('mit')).toEqual({ ok: true, expr: { type: 'license', id: 'mit' } }); // unnormalized id, since normalization is a separate concern
  });

  it('parses OR, respecting lower precedence than AND', () => {
    const result = parseSpdxExpression('MIT AND ISC OR Apache-2.0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expr).toEqual({
        type: 'or',
        left: { type: 'and', left: { type: 'license', id: 'MIT' }, right: { type: 'license', id: 'ISC' } },
        right: { type: 'license', id: 'Apache-2.0' },
      });
    }
  });

  it('respects parentheses', () => {
    const result = parseSpdxExpression('(BSD-3-Clause AND MIT) OR Apache-2.0');
    expect(result.ok).toBe(true);
  });

  it('parses a WITH exception clause', () => {
    const result = parseSpdxExpression('GPL-2.0-only WITH Classpath-exception-2.0');
    expect(result).toEqual({ ok: true, expr: { type: 'with', license: { type: 'license', id: 'GPL-2.0-only' }, exception: 'Classpath-exception-2.0' } });
  });

  it('flattenLicenseIds returns every id in an OR expression', () => {
    const result = parseSpdxExpression('MIT OR GPL-3.0-only');
    expect(result.ok).toBe(true);
    if (result.ok) expect(flattenLicenseIds(result.expr).sort()).toEqual(['GPL-3.0-only', 'MIT']);
  });

  it('mostPermissiveBranch prefers the fully-permissive OR branch', () => {
    const result = parseSpdxExpression('MIT OR GPL-3.0-only');
    expect(result.ok).toBe(true);
    if (result.ok) expect(mostPermissiveBranch(result.expr, new Set(['MIT']))).toEqual(['MIT']);
  });

  it('never throws on malformed input — returns ok:false with the raw string preserved', () => {
    expect(parseSpdxExpression('MIT OR')).toEqual({ ok: false, raw: 'MIT OR' });
    expect(parseSpdxExpression('')).toEqual({ ok: false, raw: '' });
    expect(parseSpdxExpression('SEE LICENSE IN LICENSE.txt')).toEqual({ ok: false, raw: 'SEE LICENSE IN LICENSE.txt' });
    expect(parseSpdxExpression('(unclosed AND MIT')).toEqual({ ok: false, raw: '(unclosed AND MIT' });
  });

  it('never throws on non-string input, even though the type signature says string', () => {
    expect(parseSpdxExpression(undefined as any)).toEqual({ ok: false, raw: undefined });
    expect(parseSpdxExpression(null as any)).toEqual({ ok: false, raw: null });
    expect(parseSpdxExpression({ type: 'MIT', url: 'https://example.com' } as any)).toEqual({ ok: false, raw: { type: 'MIT', url: 'https://example.com' } });
    // 42 stringifies to "42", which the tokenizer treats as a bare valid id token (it does not
    // validate against a real SPDX id list — that's out of scope for this parser), so this
    // legitimately resolves ok:true rather than ok:false. The regression this test guards against
    // is the uncaught TypeError from calling .trim() on a number, which no longer happens.
    expect(() => parseSpdxExpression(42 as any)).not.toThrow();
    expect(parseSpdxExpression(42 as any)).toEqual({ ok: true, expr: { type: 'license', id: '42' } });
  });

  it('never throws on whitespace-only, operators-only, dangling-paren, or WITH-with-no-exception input', () => {
    expect(parseSpdxExpression('   ')).toEqual({ ok: false, raw: '   ' });
    expect(parseSpdxExpression('AND OR WITH')).toEqual({ ok: false, raw: 'AND OR WITH' });
    expect(parseSpdxExpression('MIT)')).toEqual({ ok: false, raw: 'MIT)' });
    expect(parseSpdxExpression('()')).toEqual({ ok: false, raw: '()' });
    expect(parseSpdxExpression('MIT WITH')).toEqual({ ok: false, raw: 'MIT WITH' });
  });
});
