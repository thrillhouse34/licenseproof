import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { renderNotices } from '../../src/report/notices';
import { buildReportData } from '../../src/report/reportData';
import type { ResolvedPackage } from '../../src/resolve/types';
import type { ReportData } from '../../src/report/reportData';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

function makeResolved(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg', diskPath: undefined,
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

function makeReportData(overrides: Partial<ReportData>): ReportData {
  return {
    projectName: 'my-app',
    packages: [],
    warnings: [],
    projectLicense: { id: 'MIT', wasUnspecified: false },
    toolVersion: '0.2.0',
    dataVersion: '2026.07.21',
    scanTimestamp: '2026-07-21T00:00:00.000Z',
    ecosystems: ['npm'],
    projectPath: FIXTURES,
    ...overrides,
  };
}

describe('renderNotices — real fixture (fixtures/notices-fallback-chain)', () => {
  it('exercises all three text-resolution tiers against a real scan and never drops a package', async () => {
    const fixturePath = path.join(FIXTURES, 'notices-fallback-chain');
    const data = await buildReportData(fixturePath, { productionOnly: true });
    const output = renderNotices(data);

    // Sanity: the fixture really did produce all three packages under three
    // distinct resolved license strings — otherwise this test would prove
    // nothing about the fallback chain.
    expect(data.packages.map((p) => p.name).sort()).toEqual(['mit-pkg', 'ondisk-only-pkg', 'unavailable-pkg']);

    // Every package appears somewhere in the output — none silently dropped.
    for (const pkg of data.packages) {
      expect(output).toContain(`${pkg.name}@${pkg.version}`);
    }

    // Header carries provenance + the informational-not-legal-advice line.
    expect(output).toContain(data.projectName);
    expect(output).toContain('not legal advice');
    expect(output).toContain(data.toolVersion);
    expect(output).toContain(data.dataVersion);
    expect(output).toContain(data.scanTimestamp);

    // Tier (a): MIT is vendored — its real vendored text must appear verbatim,
    // not a placeholder or a "text unavailable" note.
    const mitPkg = data.packages.find((p) => p.name === 'mit-pkg')!;
    expect(mitPkg.license).toBe('MIT');
    expect(output).toContain('Permission is hereby granted, free of charge'); // MIT.txt's real opening line
    expect(output).not.toMatch(/License text unavailable for "MIT"/);

    // Tier (b): Zlib has no vendored text, but ondisk-only-pkg carries its own
    // on-disk LICENSE file — that file's content must be used verbatim.
    const onDiskPkg = data.packages.find((p) => p.name === 'ondisk-only-pkg')!;
    expect(onDiskPkg.license).toBe('Zlib');
    expect(output).toContain('ZLIB LICENSE FIXTURE MARKER TEXT');
    expect(output).not.toMatch(/License text unavailable for "Zlib"/);

    // Tier (c): BSL-1.0 has neither vendored text nor an on-disk file — the
    // honest unavailable note must appear, and nothing must be fabricated.
    const unavailablePkg = data.packages.find((p) => p.name === 'unavailable-pkg')!;
    expect(unavailablePkg.license).toBe('BSL-1.0');
    expect(output).toContain('[License text unavailable for "BSL-1.0" — no vendored text and no license file found on disk.]');
  });
});

describe('renderNotices — grouping + fallback-chain unit behavior', () => {
  it('groups packages sharing a resolved license string into one section', () => {
    const a = makeResolved({ name: 'a-pkg', license: 'MIT' });
    const b = makeResolved({ name: 'b-pkg', license: 'MIT' });
    const c = makeResolved({ name: 'c-pkg', license: 'Apache-2.0', licenseIds: ['Apache-2.0'] });
    const data = makeReportData({ packages: [a, b, c] });
    const output = renderNotices(data);

    // Exactly one "MIT" section heading (not one per package).
    const mitHeadingCount = output.split('\n').filter((l) => l.trim() === 'MIT').length;
    expect(mitHeadingCount).toBe(1);
    // Both MIT packages listed under that one section.
    expect(output).toContain('a-pkg@1.0.0');
    expect(output).toContain('b-pkg@1.0.0');
    expect(output).toContain('c-pkg@1.0.0');
  });

  it('preserves a full OR/WITH expression verbatim as the group key, never simplifying it', () => {
    const pkg = makeResolved({
      name: 'exception-pkg',
      license: 'GPL-2.0-only WITH Classpath-exception-2.0',
      licenseIds: ['GPL-2.0-only', 'Classpath-exception-2.0'],
      category: 'weak-copyleft',
    });
    const data = makeReportData({ packages: [pkg] });
    const output = renderNotices(data);
    expect(output).toContain('GPL-2.0-only WITH Classpath-exception-2.0');
    // No vendored file matches this compound expression string, and no
    // diskPath is set on this package — must fall to the honest note, not
    // silently substitute the plain GPL-2.0-only vendored text.
    expect(output).toContain('[License text unavailable for "GPL-2.0-only WITH Classpath-exception-2.0" — no vendored text and no license file found on disk.]');
  });

  it('uses vendored text for a clean single id that IS in data/license-texts/', () => {
    const pkg = makeResolved({ name: 'apache-pkg', license: 'Apache-2.0', licenseIds: ['Apache-2.0'], category: 'permissive' });
    const data = makeReportData({ packages: [pkg] });
    const output = renderNotices(data);
    expect(output).toContain('Apache License');
    expect(output).toContain('Version 2.0, January 2004');
    expect(output).not.toContain('License text unavailable');
  });

  it('never omits a package even when every tier misses (no diskPath at all)', () => {
    const pkg = makeResolved({ name: 'ghost-pkg', version: '9.9.9', license: 'Unrecognized-Id-123', licenseIds: [], category: 'unknown', diskPath: undefined });
    const data = makeReportData({ packages: [pkg] });
    const output = renderNotices(data);
    expect(output).toContain('ghost-pkg@9.9.9');
    expect(output).toContain('[License text unavailable for "Unrecognized-Id-123" — no vendored text and no license file found on disk.]');
  });

  it('never treats a hostile license string as a filesystem path (no traversal via vendored-text lookup)', () => {
    const pkg = makeResolved({ name: 'hostile-pkg', license: '../../../../etc/passwd', licenseIds: [], category: 'unknown', diskPath: undefined });
    const data = makeReportData({ packages: [pkg] });
    // Must not throw, and must fall straight to the honest note — proves the
    // vendored-text check is a Set-membership test against the real directory
    // listing, not a raw path.join + existsSync over the untrusted string.
    expect(() => renderNotices(data)).not.toThrow();
    const output = renderNotices(data);
    expect(output).toContain('[License text unavailable for "../../../../etc/passwd" — no vendored text and no license file found on disk.]');
  });

  it('sorts license groups alphabetically for deterministic output', () => {
    const z = makeResolved({ name: 'z-pkg', license: 'Zlib', licenseIds: ['Zlib'], category: 'permissive' });
    const a = makeResolved({ name: 'a-pkg', license: 'Apache-2.0', licenseIds: ['Apache-2.0'], category: 'permissive' });
    const data = makeReportData({ packages: [z, a] });
    const output = renderNotices(data);
    expect(output.indexOf('Apache-2.0')).toBeLessThan(output.indexOf('Zlib'));
  });
});
