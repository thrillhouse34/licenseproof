import { describe, it, expect } from 'vitest';
import { PERMISSIVE_IDS } from '../../src/resolve/permissiveIds';

describe('PERMISSIVE_IDS', () => {
  it('is a single shared set including Unlicense', () => {
    expect(PERMISSIVE_IDS.has('MIT')).toBe(true);
    expect(PERMISSIVE_IDS.has('ISC')).toBe(true);
    expect(PERMISSIVE_IDS.has('BSD-2-Clause')).toBe(true);
    expect(PERMISSIVE_IDS.has('BSD-3-Clause')).toBe(true);
    expect(PERMISSIVE_IDS.has('Apache-2.0')).toBe(true);
    expect(PERMISSIVE_IDS.has('0BSD')).toBe(true);
    expect(PERMISSIVE_IDS.has('Unlicense')).toBe(true);
  });
});
