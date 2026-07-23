import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pypiEcosystem } from '../../../src/ecosystems/pypi';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const POETRY_BASIC = path.join(FIXTURES, 'pypi-poetry-basic');

describe('pypiEcosystem.scan — poetry.lock tier (end-to-end)', () => {
  it('reports the full resolved tree (main + transitive + dev)', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    expect(result.ecosystems).toEqual(['pypi']);
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual([
      'certifi',
      'charset-normalizer',
      'click',
      'colorama',
      'idna',
      'iniconfig',
      'pluggy',
      'pytest',
      'requests',
      'urllib3',
    ]);
    expect(result.projectName).toBe('poetry-basic-demo');
  });

  it('marks pyproject-declared names as direct, transitive names as indirect', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    const byName = Object.fromEntries(result.packages.map((p) => [p.name, p]));
    // Declared in [tool.poetry.dependencies] (main) or a group -> direct.
    expect(byName['requests'].direct).toBe(true);
    expect(byName['click'].direct).toBe(true);
    expect(byName['pytest'].direct).toBe(true);
    // Only reached transitively -> not direct.
    expect(byName['certifi'].direct).toBe(false);
    expect(byName['colorama'].direct).toBe(false);
    expect(byName['iniconfig'].direct).toBe(false);
  });

  it('classifies dev vs. production by reachability from main deps', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    const byName = Object.fromEntries(result.packages.map((p) => [p.name, p]));
    // Production (main deps + their transitive closure).
    expect(byName['requests'].dev).toBe(false);
    expect(byName['click'].dev).toBe(false);
    expect(byName['certifi'].dev).toBe(false);
    expect(byName['charset-normalizer'].dev).toBe(false);
    expect(byName['idna'].dev).toBe(false);
    expect(byName['urllib3'].dev).toBe(false);
    // Dev-only group (pytest and deps reachable ONLY from it).
    expect(byName['pytest'].dev).toBe(true);
    expect(byName['iniconfig'].dev).toBe(true);
    expect(byName['pluggy'].dev).toBe(true);
  });

  it('keeps dev=false for a package needed by BOTH production and a dev-only group', async () => {
    // colorama is a transitive dep of click (production, via inline-table shape)
    // AND of pytest (dev, via plain-string shape). Being reachable from
    // production makes it dev=false even though a dev group also needs it.
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    const colorama = result.packages.find((p) => p.name === 'colorama')!;
    expect(colorama.dev).toBe(false);
    // Its example paths still reflect a real chain from a root.
    expect(colorama.paths.length).toBeGreaterThan(0);
    expect(colorama.paths[0][0]).toMatch(/^(click|pytest)$/);
    expect(colorama.paths[0][colorama.paths[0].length - 1]).toBe('colorama');
  });

  it('builds real dependency chains for transitive packages', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    const certifi = result.packages.find((p) => p.name === 'certifi')!;
    expect(certifi.paths).toContainEqual(['requests', 'certifi']);
    expect(certifi.pathCountAtLeast).toBeGreaterThanOrEqual(1);

    const iniconfig = result.packages.find((p) => p.name === 'iniconfig')!;
    expect(iniconfig.paths).toContainEqual(['pytest', 'iniconfig']);
  });

  it('resolves diskPath for installed packages, incl. hyphen/underscore mismatch, undefined otherwise', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    const byName = Object.fromEntries(result.packages.map((p) => [p.name, p]));
    const sp = path.join('.venv', 'lib', 'python3.11', 'site-packages');

    // installPath is always the logically-computed dist-info name.
    expect(byName['requests'].installPath).toBe('requests-2.31.0.dist-info');
    expect(byName['requests'].diskPath).toBe(path.join(sp, 'requests-2.31.0.dist-info'));

    // charset-normalizer (hyphen in lock) -> charset_normalizer-*.dist-info (underscore on disk).
    expect(byName['charset-normalizer'].installPath).toBe('charset_normalizer-3.3.0.dist-info');
    expect(byName['charset-normalizer'].diskPath).toBe(
      path.join(sp, 'charset_normalizer-3.3.0.dist-info'),
    );

    // pytest (a dev package) is installed on disk -> diskPath resolves too.
    expect(byName['pytest'].diskPath).toBe(path.join(sp, 'pytest-7.4.3.dist-info'));

    // Not installed on disk -> diskPath undefined but installPath still computed.
    expect(byName['idna'].installPath).toBe('idna-3.4.dist-info');
    expect(byName['idna'].diskPath).toBeUndefined();
    expect(byName['colorama'].diskPath).toBeUndefined();
    expect(byName['urllib3'].diskPath).toBeUndefined();
  });

  it('leaves licenseRaw undefined (poetry.lock carries no license field)', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: false });
    for (const p of result.packages) {
      expect(p.licenseRaw).toBeUndefined();
    }
  });

  it('excludes dev-only packages under productionOnly, keeps shared prod deps', async () => {
    const result = await pypiEcosystem.scan(POETRY_BASIC, { productionOnly: true });
    const names = result.packages.map((p) => p.name).sort();
    // pytest/iniconfig/pluggy are dev-only -> excluded.
    expect(names).not.toContain('pytest');
    expect(names).not.toContain('iniconfig');
    expect(names).not.toContain('pluggy');
    // requests/click/certifi/... remain; colorama stays (it's also a prod dep).
    expect(names).toContain('requests');
    expect(names).toContain('click');
    expect(names).toContain('colorama');
  });
});
