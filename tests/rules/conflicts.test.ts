import { describe, it, expect } from 'vitest';
import { checkConflicts, deriveProjectLicenseMode } from '../../src/rules/conflicts';

describe('deriveProjectLicenseMode', () => {
  it('maps "proprietary" and empty string to proprietary, MIT to permissive, GPL-3.0-only to gpl-family', () => {
    expect(deriveProjectLicenseMode('proprietary')).toBe('proprietary');
    expect(deriveProjectLicenseMode('')).toBe('proprietary');
    expect(deriveProjectLicenseMode('MIT')).toBe('permissive');
    expect(deriveProjectLicenseMode('GPL-3.0-only')).toBe('gpl-family');
  });
  it('treats a project declaring Unlicense as permissive mode (the reconciled shared set)', () => {
    expect(deriveProjectLicenseMode('Unlicense')).toBe('permissive');
  });

  describe('OR/AND/WITH expressions (previously silently collapsed to proprietary)', () => {
    it('derives permissive mode from the permissive branch of an OR expression, not proprietary', () => {
      expect(deriveProjectLicenseMode('MIT OR GPL-3.0-only')).toBe('permissive');
      expect(deriveProjectLicenseMode('GPL-3.0-only OR Apache-2.0')).toBe('permissive');
    });

    it('derives gpl-family mode from an AND expression containing a GPL-family id (conservative: both apply)', () => {
      expect(deriveProjectLicenseMode('MIT AND GPL-3.0-only')).toBe('gpl-family');
    });

    it('derives permissive mode from a WITH expression whose base license is permissive', () => {
      expect(deriveProjectLicenseMode('Apache-2.0 WITH LLVM-exception')).toBe('permissive');
    });

    it('derives gpl-family mode when neither OR branch is fully permissive', () => {
      expect(deriveProjectLicenseMode('GPL-3.0-only OR GPL-2.0-only')).toBe('gpl-family');
    });
  });

  describe('genuinely unparseable input reaching this function directly (defensive, not the normal call path)', () => {
    it('falls back to proprietary, same as the original single-id behavior', () => {
      expect(deriveProjectLicenseMode('not a real license expression OR')).toBe('proprietary');
    });
  });
});

describe('checkConflicts', () => {
  it('flags strong-copyleft as CONFLICT under proprietary, REVIEW under permissive', () => {
    expect(checkConflicts('strong-copyleft', ['GPL-3.0-only'], 'proprietary')).toEqual({ level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false });
    expect(checkConflicts('strong-copyleft', ['GPL-3.0-only'], 'permissive')).toEqual({ level: 'REVIEW', explanationKey: 'copyleft-in-permissive-project', agplNetworkedUse: false });
  });
  it('always sets agplNetworkedUse for AGPL regardless of project mode', () => {
    const result = checkConflicts('strong-copyleft', ['AGPL-3.0-only'], 'permissive');
    expect(result.agplNetworkedUse).toBe(true);
    expect(result.level).toBe('CONFLICT');
    expect(result.explanationKey).toBe('agpl-networked-use');
  });
  it('flags weak-copyleft as REVIEW, noncommercial as CONFLICT (any mode), unknown as REVIEW', () => {
    expect(checkConflicts('weak-copyleft', ['MPL-2.0'], 'proprietary').level).toBe('REVIEW');
    expect(checkConflicts('noncommercial', ['BUSL-1.1'], 'permissive').level).toBe('CONFLICT');
    expect(checkConflicts('unknown', ['Some-Made-Up-License'], 'proprietary').level).toBe('REVIEW');
  });
  it('flags Apache-2.0 under a gpl-family project as REVIEW', () => {
    const result = checkConflicts('permissive', ['Apache-2.0'], 'gpl-family');
    expect(result.level).toBe('REVIEW');
    expect(result.explanationKey).toBe('gpl-apache-incompatibility');
  });
  it('produces NONE with no explanation key for permissive-in-permissive', () => {
    expect(checkConflicts('permissive', ['MIT'], 'permissive')).toEqual({ level: 'NONE', explanationKey: null, agplNetworkedUse: false });
  });
});
