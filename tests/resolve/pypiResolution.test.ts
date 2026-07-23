import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pypiEcosystem } from '../../src/ecosystems/pypi';
import { resolveProject } from '../../src/resolve/resolveProject';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

async function scanAndResolve(fixtureName: string, projectLicenseId: string) {
  const dir = path.join(FIXTURES, fixtureName);
  const scanResult = await pypiEcosystem.scan(dir, { productionOnly: false });
  return resolveProject(dir, scanResult, projectLicenseId).packages;
}

describe('PyPI license resolution pipeline (Task 6) — end-to-end through resolveProject', () => {
  it('PEP 639: resolves a clean License-Expression field, source "expression", no false disagreement with an agreeing classifier', async () => {
    const resolved = await scanAndResolve('pypi-pep639', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'cleanpkg')!;
    expect(pkg.source).toBe('expression');
    expect(pkg.license).toBe('MIT');
    expect(pkg.category).toBe('permissive');
    // License-Expression MIT and the "MIT License" classifier agree, so no
    // disagreement bump — a proprietary project with a permissive dep is NONE.
    expect(pkg.conflict.level).toBe('NONE');
    expect(pkg.conflict.explanationKey).toBeNull();
  });

  it('classifier-only: falls to a mapped Trove classifier when License is unparseable ("UNKNOWN"), source "classifier"', async () => {
    const resolved = await scanAndResolve('pypi-classifier-only', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'classifierpkg')!;
    expect(pkg.source).toBe('classifier');
    expect(pkg.license).toBe('BSD-3-Clause'); // "License :: OSI Approved :: BSD License" -> BSD-3-Clause
    expect(pkg.category).toBe('permissive');
    expect(pkg.confidence).toBe('medium');
    expect(pkg.conflict.level).toBe('NONE'); // only one signal resolved — no disagreement possible
  });

  it('disagreement: License:MIT vs Apache classifier -> primary is MIT (more specific field), level bumped to REVIEW with the disagreement key', async () => {
    const resolved = await scanAndResolve('pypi-license-classifier-disagreement', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'disagreepkg')!;
    // More specific/parseable field (License) wins as the reported license.
    expect(pkg.source).toBe('metadata');
    expect(pkg.license).toBe('MIT');
    expect(pkg.licenseIds).toEqual(['MIT']);
    expect(pkg.category).toBe('permissive');
    // ...but the metadata-vs-classifier disagreement is surfaced, not silently swallowed.
    // CRITICAL REGRESSION GUARD for the family-aware fix: MIT and Apache-2.0 are BOTH
    // `permissive` but belong to DIFFERENT license families, so this is a genuine
    // disagreement that MUST still flag. A pure same-category suppression would wrongly
    // hide it; the family-based rule keeps it visible.
    expect(pkg.conflict.level).toBe('REVIEW');
    expect(pkg.conflict.explanationKey).toBe('pypi-metadata-classifier-disagreement');
  });

  it('same-family variant ambiguity is NOT a disagreement: License-Expression:BSD-2-Clause + generic "BSD License" classifier (maps to BSD-3-Clause)', async () => {
    // The real, extremely common bug case. data/classifier-to-spdx.json deliberately
    // maps "License :: OSI Approved :: BSD License" onto the representative BSD-3-Clause,
    // documenting (in its own `note`) that this is safe because same-family candidates
    // share a category. So BSD-2-Clause metadata + generic BSD classifier is NOT a
    // disagreement — both agree the package is BSD/permissive, differing only on which
    // BSD variant. Before the fix, the exact-id-only check flagged it as a false REVIEW.
    const resolved = await scanAndResolve('pypi-bsd-variant-classifier', 'proprietary');
    const pkg = resolved.find((p) => p.name === 'bsdvariantpkg')!;
    expect(pkg.source).toBe('expression');
    expect(pkg.license).toBe('BSD-2-Clause');
    expect(pkg.licenseIds).toEqual(['BSD-2-Clause']);
    expect(pkg.category).toBe('permissive');
    // No false disagreement bump: a proprietary project with a permissive dep is NONE.
    expect(pkg.conflict.level).toBe('NONE');
    expect(pkg.conflict.explanationKey).toBeNull();
  });

  it('same-family suppression also holds across a copyleft family: License-Expression:GPL-2.0-only + generic "GPL" classifier (maps to GPL-3.0-only)', async () => {
    // Proves the fix is not BSD/permissive-specific. The generic
    // "GNU General Public License (GPL)" classifier maps to GPL-3.0-only, while the
    // metadata declares GPL-2.0-only — same GPL family, so no disagreement flag. Scanned
    // under a GPL-3.0-only project so the strong-copyleft dep itself resolves to a clean
    // NONE (checkConflicts: strong-copyleft under gpl-family mode = NONE); therefore the
    // ONLY thing that could bump the level here is the disagreement post-processing, so a
    // NONE/null result specifically confirms the family suppression fired.
    const resolved = await scanAndResolve('pypi-gpl-variant-classifier', 'GPL-3.0-only');
    const pkg = resolved.find((p) => p.name === 'gplvariantpkg')!;
    expect(pkg.source).toBe('expression');
    expect(pkg.license).toBe('GPL-2.0-only');
    expect(pkg.licenseIds).toEqual(['GPL-2.0-only']);
    expect(pkg.category).toBe('strong-copyleft');
    expect(pkg.conflict.level).toBe('NONE');
    expect(pkg.conflict.explanationKey).toBeNull();
  });
});
