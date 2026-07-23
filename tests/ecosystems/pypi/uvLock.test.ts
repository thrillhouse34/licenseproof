import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pypiEcosystem } from '../../../src/ecosystems/pypi';
import { parseUvLock } from '../../../src/ecosystems/pypi/uvLockParser';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const UV_BASIC = path.join(FIXTURES, 'pypi-uv-basic');

describe('pypiEcosystem.scan — uv.lock tier (end-to-end)', () => {
  it('reports production + dev deps resolved from the self-contained uv.lock', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    expect(result.ecosystems).toEqual(['pypi']);
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['click', 'jinja2', 'markupsafe', 'sphinx']);
    expect(result.projectName).toBe('webwidget');
  });

  it('resolves the correct versions (canonical, first-listed on a marker split)', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    const versionOf = (n: string) => result.packages.find((p) => p.name === n)!.version;
    expect(versionOf('click')).toBe('8.1.7');
    expect(versionOf('jinja2')).toBe('3.1.4');
    expect(versionOf('markupsafe')).toBe('2.1.5');
    // sphinx appears twice (7.4.7 for py<3.11, 8.0.2 for py>=3.11) — collapsed
    // to the FIRST-listed version.
    expect(versionOf('sphinx')).toBe('7.4.7');
  });

  it('emits ONE disclosure warning naming the marker-collapsed package(s), never silent', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    const collapseWarnings = result.warnings.filter((w) =>
      w.includes('more than one [[package]] block'),
    );
    expect(collapseWarnings).toHaveLength(1);
    expect(collapseWarnings[0]).toContain('sphinx');
    expect(collapseWarnings[0]).toContain('1 package name');
  });

  it('classifies dev vs. production correctly (prod wins when both reach a package)', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    const devOf = (n: string) => result.packages.find((p) => p.name === n)!.dev;
    expect(devOf('click')).toBe(false); // prod direct
    expect(devOf('jinja2')).toBe(false); // prod direct (also reached via dev sphinx -> prod wins)
    expect(devOf('markupsafe')).toBe(false); // transitive of prod jinja2
    expect(devOf('sphinx')).toBe(true); // only reachable via the dev group
  });

  it('sets `direct` only for top-level-declared packages (prod deps + dev groups)', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    const directOf = (n: string) => result.packages.find((p) => p.name === n)!.direct;
    expect(directOf('click')).toBe(true);
    expect(directOf('jinja2')).toBe(true);
    expect(directOf('sphinx')).toBe(true); // declared in [package.dev-dependencies].dev
    expect(directOf('markupsafe')).toBe(false); // transitive only
  });

  it('builds real dependency-chain paths via the shared buildPaths (name-keyed)', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    // jinja2 is a genuine diamond: reached directly (prod root) AND via the dev
    // sphinx edge — buildPaths surfaces BOTH real chains, count = 2.
    const jinja2 = result.packages.find((p) => p.name === 'jinja2')!;
    expect(jinja2.paths).toContainEqual(['jinja2']);
    expect(jinja2.paths).toContainEqual(['sphinx', 'jinja2']);
    expect(jinja2.pathCountAtLeast).toBe(2);
    // markupsafe inherits jinja2's two chains, one hop deeper.
    const markupsafe = result.packages.find((p) => p.name === 'markupsafe')!;
    expect(markupsafe.paths).toContainEqual(['jinja2', 'markupsafe']);
    expect(markupsafe.pathCountAtLeast).toBe(2);
  });

  it('resolves diskPath against the real .venv, including hyphen/underscore + case folding', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    const sp = path.join('.venv', 'lib', 'python3.11', 'site-packages');
    const diskOf = (n: string) => result.packages.find((p) => p.name === n)!.diskPath;
    expect(diskOf('click')).toBe(path.join(sp, 'click-8.1.7.dist-info'));
    expect(diskOf('sphinx')).toBe(path.join(sp, 'sphinx-7.4.7.dist-info'));
    // markupsafe: lockfile name "markupsafe" (lowercase), on-disk dir
    // "MarkupSafe-2.1.5.dist-info" (capitalized) — PEP 503 normalization folds
    // both to the same key.
    const markupsafe = result.packages.find((p) => p.name === 'markupsafe')!;
    expect(markupsafe.installPath).toBe('markupsafe-2.1.5.dist-info');
    expect(markupsafe.diskPath).toBe(path.join(sp, 'MarkupSafe-2.1.5.dist-info'));
  });

  it('leaves licenseRaw undefined for every uv.lock package (no license field in the lockfile)', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: false });
    for (const p of result.packages) {
      expect(p.licenseRaw).toBeUndefined();
    }
  });

  it('excludes dev-only packages under productionOnly', async () => {
    const result = await pypiEcosystem.scan(UV_BASIC, { productionOnly: true });
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['click', 'jinja2', 'markupsafe']);
    expect(names).not.toContain('sphinx');
  });
});

describe('parseUvLock — unit-level edge cases', () => {
  it('identifies the root project via source = { virtual = "." } (not by name-matching)', () => {
    const lock = `
version = 1

[[package]]
name = "myproj"
version = "0.0.0"
source = { virtual = "." }
dependencies = [
    { name = "requests" },
]

[[package]]
name = "requests"
version = "2.31.0"
source = { registry = "https://pypi.org/simple" }
`;
    const { packages, warnings } = parseUvLock(lock, { productionOnly: false });
    expect(packages.map((p) => p.name)).toEqual(['requests']);
    expect(packages[0].direct).toBe(true);
    expect(packages[0].dev).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('warns and reports nothing when no root project entry exists', () => {
    const lock = `
version = 1

[[package]]
name = "requests"
version = "2.31.0"
source = { registry = "https://pypi.org/simple" }
`;
    const { packages, warnings } = parseUvLock(lock, { productionOnly: false });
    expect(packages).toEqual([]);
    expect(warnings.some((w) => w.includes('no root project entry'))).toBe(true);
  });

  it('does not crash on malformed TOML — warns and reports nothing', () => {
    const { packages, warnings } = parseUvLock('this is = = not toml [[', {
      productionOnly: false,
    });
    expect(packages).toEqual([]);
    expect(warnings.some((w) => w.includes('could not be parsed as TOML'))).toBe(true);
  });
});
