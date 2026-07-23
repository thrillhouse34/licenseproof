import { describe, it, expect } from 'vitest';
import { getDataManifest, getDataVersion } from '../../src/resolve/dataManifest';

describe('dataManifest', () => {
  it('loads dataVersion, spdxListVersion, and generatedAt from data/manifest.json', () => {
    const manifest = getDataManifest();
    expect(manifest.dataVersion).toBe('2026.07.21.2');
    expect(manifest.spdxListVersion).toBe('e4c1f27');
    expect(manifest.generatedAt).toBe('2026-07-21T18:27:21-07:00');
  });

  it('getDataVersion returns just the version string', () => {
    expect(getDataVersion()).toBe('2026.07.21.2');
  });
});
