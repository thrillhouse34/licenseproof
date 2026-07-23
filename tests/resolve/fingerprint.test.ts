import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../../src/paths';
import { fingerprintLicenseText } from '../../src/resolve/fingerprint';

const MIT_TEXT = fs.readFileSync(path.join(DATA_DIR, 'license-texts', 'MIT.txt'), 'utf8');

describe('fingerprintLicenseText', () => {
  it('identifies the real vendored MIT text at high similarity', () => {
    const result = fingerprintLicenseText(MIT_TEXT);
    expect(result).not.toBeNull();
    expect(result!.licenseId).toBe('MIT');
    expect(result!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('identifies a lightly modified MIT text at low-but-passing similarity', () => {
    // Word list tuned empirically against the REAL vendored MIT.txt (see task-4-report.md)
    // so the resulting similarity lands inside the required [0.75, 0.9) band. The brief's
    // original 4-word list scored ~0.918 (too high, since "copyright" is stripped anyway
    // by the copyright-line regex) -- this 6-word list scores ~0.879.
    const modified = MIT_TEXT
      .replace(/permission/gi, 'authorization')
      .replace(/software/gi, 'program')
      .replace(/warranty/gi, 'guarantee')
      .replace(/liable/gi, 'responsible')
      .replace(/claim/gi, 'assertion')
      .replace(/damages/gi, 'losses');
    const result = fingerprintLicenseText(modified);
    expect(result).not.toBeNull();
    expect(result!.licenseId).toBe('MIT');
    expect(result!.similarity).toBeGreaterThanOrEqual(0.75);
    expect(result!.similarity).toBeLessThan(0.9);
  });

  it('returns null for unrelated text', () => {
    expect(fingerprintLicenseText('This is a shopping list: milk, eggs, bread, and coffee.')).toBeNull();
  });

  it('tolerates copyright-line variance (different holder/year should not reduce similarity)', () => {
    const withDifferentHolder = MIT_TEXT.replace(/Copyright \(c\).*/i, 'Copyright (c) 2024 Some Totally Different Company Name Inc.');
    const result = fingerprintLicenseText(withDifferentHolder);
    expect(result).not.toBeNull();
    expect(result!.licenseId).toBe('MIT');
    expect(result!.similarity).toBeGreaterThanOrEqual(0.9);
  });
});
