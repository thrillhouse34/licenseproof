import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  pypiEcosystem,
  normalizePypiName,
  expectedDistInfoName,
  buildSitePackagesResolver,
} from '../../src/ecosystems/pypi';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

describe('pypiEcosystem.detect', () => {
  it('detects via requirements.txt presence', () => {
    expect(pypiEcosystem.detect(path.join(FIXTURES, 'pypi-pinned-requirements'))).toBe(true);
  });
  it('detects via pyproject.toml presence', () => {
    expect(pypiEcosystem.detect(path.join(FIXTURES, 'pypi-declared-only'))).toBe(true);
  });
  it('does not detect a directory with none of the four marker files', () => {
    expect(pypiEcosystem.detect(path.join(FIXTURES, 'package-lock-v3-basic'))).toBe(false);
  });
});

describe('normalizePypiName / expectedDistInfoName', () => {
  it('PEP 503 normalizes names (case + -_. collapse to -)', () => {
    expect(normalizePypiName('Typing_Extensions')).toBe('typing-extensions');
    expect(normalizePypiName('zope.interface')).toBe('zope-interface');
    expect(normalizePypiName('a--_.-b')).toBe('a-b');
  });
  it('computes the expected dist-info name with underscores', () => {
    expect(expectedDistInfoName('typing-extensions', '4.9.0')).toBe('typing_extensions-4.9.0.dist-info');
    expect(expectedDistInfoName('requests', '2.31.0')).toBe('requests-2.31.0.dist-info');
  });
});

describe('pypiEcosystem.scan — requirements.txt pinned tier + diskPath resolution', () => {
  it('reports the pinned packages, flat and direct, with the no-transitive warning', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-pinned-requirements'),
      { productionOnly: false },
    );
    expect(result.ecosystems).toEqual(['pypi']);
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['click', 'not-installed-pkg', 'requests', 'typing-extensions']);
    for (const p of result.packages) {
      expect(p.direct).toBe(true);
      expect(p.paths).toEqual([[p.name]]);
      expect(p.pathCountAtLeast).toBe(1);
    }
    expect(result.warnings.some((w) => w.includes('no transitive dependency information'))).toBe(true);
  });

  it('warns about unresolvable (non-pinned) requirement lines, naming them, never silently dropping', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-pinned-requirements'),
      { productionOnly: false },
    );
    const warn = result.warnings.find((w) => w.includes('cannot be resolved'));
    expect(warn).toBeDefined();
    expect(warn).toContain('some-range');
  });

  it('resolves diskPath for an installed package whose on-disk dir differs in hyphen/underscore form', async () => {
    // typing-extensions (lockfile/pin name, hyphen) -> typing_extensions-4.9.0.dist-info (on disk, underscore)
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-pinned-requirements'),
      { productionOnly: false },
    );
    const te = result.packages.find((p) => p.name === 'typing-extensions')!;
    expect(te.installPath).toBe('typing_extensions-4.9.0.dist-info');
    expect(te.diskPath).toBe(
      path.join('.venv', 'lib', 'python3.11', 'site-packages', 'typing_extensions-4.9.0.dist-info'),
    );

    const requests = result.packages.find((p) => p.name === 'requests')!;
    expect(requests.diskPath).toBe(
      path.join('.venv', 'lib', 'python3.11', 'site-packages', 'requests-2.31.0.dist-info'),
    );
  });

  it('leaves diskPath undefined for a pinned package not present in site-packages', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-pinned-requirements'),
      { productionOnly: false },
    );
    const missing = result.packages.find((p) => p.name === 'not-installed-pkg')!;
    expect(missing.installPath).toBe('not_installed_pkg-1.0.0.dist-info'); // still computed logically
    expect(missing.diskPath).toBeUndefined();
  });
});

describe('pypiEcosystem.scan — pyproject.toml declared-only fallback tier', () => {
  it('reports main + optional-group deps as declared-only (unresolved versions) with the fallback warning', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-declared-only'),
      { productionOnly: false },
    );
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toContain('requests');
    expect(names).toContain('pytest'); // from [project.optional-dependencies].dev
    expect(names).toContain('sphinx'); // from [project.optional-dependencies].docs
    for (const p of result.packages) {
      expect(p.version).toBe('unresolved (no lockfile)');
      expect(p.diskPath).toBeUndefined(); // no venv in this fixture
    }
    expect(result.warnings.some((w) => w.includes('declared top-level dependencies only'))).toBe(true);
    expect(result.projectName).toBe('fixture-declared-only');
  });

  it('excludes dev/optional-group deps under productionOnly', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-declared-only'),
      { productionOnly: true },
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('requests');
    expect(names).not.toContain('pytest');
    expect(names).not.toContain('sphinx');
  });
});

describe('pypiEcosystem.scan — missing-venv graceful degradation', () => {
  it('resolves the pinned packages but leaves every diskPath undefined when no venv exists', async () => {
    const result = await pypiEcosystem.scan(
      path.join(FIXTURES, 'pypi-missing-venv'),
      { productionOnly: false },
    );
    expect(result.packages.map((p) => p.name).sort()).toEqual(['flask', 'jinja2']);
    for (const p of result.packages) {
      expect(p.diskPath).toBeUndefined();
    }
  });
});

describe('buildSitePackagesResolver (shared, reused by Tasks 4/5)', () => {
  it('reports the site-packages dir and resolves normalized names for a real venv layout', () => {
    const resolver = buildSitePackagesResolver(path.join(FIXTURES, 'pypi-pinned-requirements'));
    expect(resolver.sitePackagesDir).toBe(path.join('.venv', 'lib', 'python3.11', 'site-packages'));
    // hyphen-form lookup finds the underscore-form on-disk dir
    expect(resolver.resolve('typing-extensions')).toBe(
      path.join('.venv', 'lib', 'python3.11', 'site-packages', 'typing_extensions-4.9.0.dist-info'),
    );
    // underscore-form lookup finds the same dir
    expect(resolver.resolve('typing_extensions')).toBe(
      path.join('.venv', 'lib', 'python3.11', 'site-packages', 'typing_extensions-4.9.0.dist-info'),
    );
    expect(resolver.resolve('nonexistent')).toBeUndefined();
  });

  it('returns an always-undefined resolver when no venv is present', () => {
    const resolver = buildSitePackagesResolver(path.join(FIXTURES, 'pypi-missing-venv'));
    expect(resolver.sitePackagesDir).toBeUndefined();
    expect(resolver.resolve('flask')).toBeUndefined();
  });
});
