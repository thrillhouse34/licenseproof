import { describe, it, expect } from 'vitest';
import { parseDataVersionDate, dataCurrencyNote } from '../../src/license/dataCurrency';

describe('parseDataVersionDate', () => {
  it('parses YYYY.MM.DD into a UTC date', () => {
    expect(parseDataVersionDate('2026.07.21')?.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('ignores a trailing .N sub-version (YYYY.MM.DD.N)', () => {
    expect(parseDataVersionDate('2026.07.21.2')?.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('returns undefined for a non-date-shaped version', () => {
    expect(parseDataVersionDate('nope')).toBeUndefined();
    expect(parseDataVersionDate('2026.07')).toBeUndefined();
    expect(parseDataVersionDate('2026.xx.21')).toBeUndefined();
  });
});

describe('dataCurrencyNote — informational only, never nags', () => {
  it('returns a note when the installed data postdates the license window', () => {
    // updatesUntil is a year in the past; installed data is newer.
    const note = dataCurrencyNote('2020-01-01T00:00:00.000Z', '2026.07.21.2');
    expect(note).toBeTruthy();
    expect(note).toContain('2026.07.21.2'); // names the installed data version
    expect(note).toContain('2020-01-01'); // names the license window end (date only)
    expect(note!.toLowerCase()).toContain('informational');
    // Never alarming — no "warning"/"expired"/"error" language.
    expect(note!.toLowerCase()).not.toMatch(/warning|expired|error|danger/);
  });

  it('returns undefined when the installed data is within the license window', () => {
    // updatesUntil far in the future; installed data is older → no note.
    expect(dataCurrencyNote('2099-01-01T00:00:00.000Z', '2026.07.21.2')).toBeUndefined();
  });

  it('data dated the SAME calendar day as updatesUntil is still within window (no note)', () => {
    // Data date is UTC midnight of 2026-07-21, updatesUntil is later that same day.
    expect(dataCurrencyNote('2026-07-21T08:00:00.000Z', '2026.07.21')).toBeUndefined();
  });

  it('data dated one day after updatesUntil produces a note', () => {
    expect(dataCurrencyNote('2026-07-21T08:00:00.000Z', '2026.07.22')).toBeTruthy();
  });

  it('returns undefined on unparseable inputs (degrades silently)', () => {
    expect(dataCurrencyNote('not-a-date', '2026.07.21')).toBeUndefined();
    expect(dataCurrencyNote('2026-07-21T00:00:00.000Z', 'not-a-version')).toBeUndefined();
  });
});
