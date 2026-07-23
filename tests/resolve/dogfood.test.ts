import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { npmEcosystem } from '../../src/ecosystems/npm';
import { resolveProject } from '../../src/resolve/resolveProject';

describe('dogfood: licenseproof resolves its own dependency tree', () => {
  it('every real dependency resolves at confidence >= medium with a recorded source, zero UNKNOWNs', async () => {
    const projectPath = path.join(__dirname, '..', '..');
    const scanResult = await npmEcosystem.scan(projectPath, { productionOnly: false });
    const { packages: resolved } = resolveProject(projectPath, scanResult, 'MIT'); // this project's own declared license

    const unknowns = resolved.filter((p) => p.category === 'unknown');
    if (unknowns.length > 0) {
      // Surface exactly which packages failed, so a real failure here is
      // immediately actionable rather than just "8 failed, good luck".
      console.error('Unresolved packages:', unknowns.map((p) => `${p.name}@${p.version} (source: ${p.source})`));
    }
    expect(unknowns).toHaveLength(0);

    const lowConfidenceNonFingerprint = resolved.filter((p) => p.confidence === 'low' && p.source !== 'license-file' && p.source !== 'readme');
    expect(lowConfidenceNonFingerprint).toHaveLength(0);

    for (const pkg of resolved) {
      expect(pkg.source).not.toBe('none');
      expect(['high', 'medium'].includes(pkg.confidence) || pkg.source === 'license-file' || pkg.source === 'readme').toBe(true);
    }
  });
});
