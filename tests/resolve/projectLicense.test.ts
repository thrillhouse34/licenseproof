import { describe, it, expect } from 'vitest';
import { resolveProjectLicenseContext } from '../../src/resolve/projectLicense';
import { deriveProjectLicenseMode } from '../../src/rules/conflicts';

describe('resolveProjectLicenseContext', () => {
  it('uses the manifest license when no CLI override is given', () => {
    expect(resolveProjectLicenseContext('MIT', undefined)).toEqual({ displayId: 'MIT', modeId: 'MIT', wasUnspecified: false });
  });

  it('CLI override wins over the manifest license', () => {
    expect(resolveProjectLicenseContext('MIT', 'GPL-3.0-only')).toEqual({ displayId: 'GPL-3.0-only', modeId: 'GPL-3.0-only', wasUnspecified: false });
  });

  it('treats an absent manifest license and no override as unspecified, strictest mode', () => {
    expect(resolveProjectLicenseContext(undefined, undefined)).toEqual({ displayId: 'unspecified', modeId: 'proprietary', wasUnspecified: true });
  });

  it('treats an unparseable manifest license as unspecified', () => {
    expect(resolveProjectLicenseContext('not a real license expression OR', undefined)).toEqual({ displayId: 'unspecified', modeId: 'proprietary', wasUnspecified: true });
  });

  it('treats whitespace-only as unspecified', () => {
    expect(resolveProjectLicenseContext('   ', undefined)).toEqual({ displayId: 'unspecified', modeId: 'proprietary', wasUnspecified: true });
  });

  // The unparseable case above was already non-silent BEFORE this fix — it
  // sets wasUnspecified: true, which triggers the existing "No license
  // declared or recognized..." warning render in summary.ts. The confirmed
  // gap this fix closes is different: a VALID OR/AND/WITH expression is kept
  // verbatim as modeId (correct, unchanged), but that raw multi-id string
  // used to silently collapse to the conservative "proprietary" mode once it
  // reached deriveProjectLicenseMode, with no warning that the simplification
  // had happened. These cases confirm the context resolution itself is
  // unchanged (modeId stays the raw expression) AND that feeding modeId into
  // deriveProjectLicenseMode now derives from the permissive branch instead
  // of silently defaulting to proprietary.
  describe('OR-expression project licenses feed a correctly-derived mode (not silently proprietary)', () => {
    it('MIT OR GPL-3.0-only: modeId is kept verbatim, and derives permissive mode from the MIT branch', () => {
      const ctx = resolveProjectLicenseContext('MIT OR GPL-3.0-only', undefined);
      expect(ctx).toEqual({ displayId: 'MIT OR GPL-3.0-only', modeId: 'MIT OR GPL-3.0-only', wasUnspecified: false });
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('permissive');
    });

    it('GPL-3.0-only OR Apache-2.0: modeId is kept verbatim, and derives permissive mode from the Apache-2.0 branch', () => {
      const ctx = resolveProjectLicenseContext('GPL-3.0-only OR Apache-2.0', undefined);
      expect(ctx).toEqual({ displayId: 'GPL-3.0-only OR Apache-2.0', modeId: 'GPL-3.0-only OR Apache-2.0', wasUnspecified: false });
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('permissive');
    });

    it('no regression: plain MIT still derives permissive mode', () => {
      const ctx = resolveProjectLicenseContext('MIT', undefined);
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('permissive');
    });

    it('no regression: plain "proprietary" still derives proprietary mode', () => {
      const ctx = resolveProjectLicenseContext('proprietary', undefined);
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('proprietary');
    });

    it('no regression: empty/absent license still derives proprietary mode', () => {
      const ctx = resolveProjectLicenseContext(undefined, undefined);
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('proprietary');
    });

    it('no regression: genuinely unparseable garbage still derives proprietary mode (via the unchanged wasUnspecified path)', () => {
      const ctx = resolveProjectLicenseContext('not a real license expression OR', undefined);
      expect(ctx.wasUnspecified).toBe(true);
      expect(deriveProjectLicenseMode(ctx.modeId)).toBe('proprietary');
    });
  });
});
