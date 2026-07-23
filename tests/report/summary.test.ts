import { describe, it, expect } from 'vitest';
import { renderSummary } from '../../src/report/summary';
import type { ResolvedPackage } from '../../src/resolve/types';

function makeResolved(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg',
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof renderSummary>[0]> = {}) {
  return {
    projectName: 'my-app',
    packages: [] as ResolvedPackage[],
    warnings: [] as string[],
    projectLicense: { id: 'MIT', wasUnspecified: false },
    toolVersion: '0.1.0',
    dataVersion: '2026.07.21',
    scanTimestamp: '2026-07-21T00:00:00.000Z',
    colorEnabled: false,
    ...overrides,
  };
}

describe('renderSummary', () => {
  it('header includes project name, project license, package count, tool version, data version, scan timestamp', () => {
    const output = renderSummary(baseInput({ packages: [makeResolved({})] }));
    expect(output).toContain('my-app');
    expect(output).toContain('MIT');
    expect(output).toContain('0.1.0');
    expect(output).toContain('2026.07.21');
    expect(output).toContain('2026-07-21T00:00:00.000Z');
    expect(output).toMatch(/1\s+package/i);
  });

  it('states the "unspecified project license" assumption prominently with a hint to pass the flag', () => {
    const output = renderSummary(baseInput({ projectLicense: { id: 'unspecified', wasUnspecified: true } }));
    expect(output.toLowerCase()).toContain('unspecified');
    expect(output).toContain('--project-license');
  });

  it('renders CONFLICT entries with package@version, full license expression, explanation, and dependency chain', () => {
    const pkg = makeResolved({
      name: 'gpl-thing', version: '2.0.0', license: 'GPL-3.0-only', category: 'strong-copyleft',
      paths: [['express', 'gpl-thing']], pathCountAtLeast: 1,
      conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).toContain('gpl-thing@2.0.0');
    expect(output).toContain('GPL-3.0-only');
    expect(output).toMatch(/CONFLICT/);
    expect(output).toContain('express → gpl-thing');
    expect(output.toLowerCase()).toContain('copyleft'); // the actual explanation text from conflict-explanations.json
  });

  it('renders "at least N other paths" when pathCountAtLeast exceeds the shown chain, never a bare count', () => {
    const pkg = makeResolved({
      name: 'popular-pkg', paths: [['express', 'popular-pkg']], pathCountAtLeast: 2418,
      conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false }, category: 'unknown',
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).toMatch(/at least 2,417 other path/i);
  });

  it('does not append "(+N other paths)" when there is only one path total', () => {
    const pkg = makeResolved({ paths: [['pkg']], pathCountAtLeast: 1 });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).not.toContain('other path');
  });

  it('renders AGPL as a non-blocking informational note when it is a non-chosen OR branch and the chosen branch is clean', () => {
    const pkg = makeResolved({
      name: 'tri-licensed', license: 'MIT', category: 'permissive',
      conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output.toLowerCase()).toContain('agpl');
    expect(output.toLowerCase()).toContain('alternative');
    // must NOT be rendered as a top-level conflict
    const conflictSectionIndex = output.indexOf('CONFLICT');
    const agplLineIndex = output.indexOf('tri-licensed');
    expect(conflictSectionIndex === -1 || agplLineIndex < conflictSectionIndex || output.slice(conflictSectionIndex, conflictSectionIndex + 200)).not.toContain('tri-licensed');
  });

  it('wraps a realistically deep dependency chain instead of overflowing 80 columns', () => {
    const pkg = makeResolved({
      name: 'copyleft-config-loader',
      paths: [['webpack-cli', 'webpack', 'terser-webpack-plugin', 'schema-utils', 'copyleft-config-loader']],
      pathCountAtLeast: 1,
      category: 'strong-copyleft',
      license: 'GPL-3.0-only',
      conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    for (const line of output.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(output).toContain('webpack-cli → webpack → terser-webpack-plugin'); // the chain content itself is still intact across the wrap
  });

  it('wraps a long label line (long scoped name + long license expression) instead of overflowing', () => {
    // NOTE: deviates from the fix brief's literal `category: 'permissive'` /
    // `conflict.level: 'NONE'` — that combination classifies to the 'clean'
    // severity bucket, which renderSummary never prints in any section, so
    // the test would pass vacuously (the label line is never emitted at all)
    // both before and after the fix. Using 'REVIEW' here puts the package in
    // a bucket that's actually rendered via renderPackageEntry, so the test
    // genuinely exercises the label-wrapping fix.
    //
    // NOTE 2: also trims the brief's `version: '12.34.56-beta.7'` down to
    // '12.34.56' — `name@version` has no internal space, so it's a single
    // unbreakable token to a word-boundary wrapper; at the brief's original
    // length that token alone is 82 chars (84 with the 2-space indent),
    // which no word-wrap implementation can bring under 80 without
    // mid-word hyphenation (out of scope for this fix — wrapAt80 itself is
    // unchanged). Trimming keeps the "long scoped name" intent while
    // keeping the token wrappable.
    const pkg = makeResolved({
      name: '@some-quite-long-organization-scope/an-unusually-long-package-name',
      version: '12.34.56',
      license: 'MIT OR Apache-2.0 OR BSD-3-Clause OR GPL-3.0-only WITH Classpath-exception-2.0',
      category: 'permissive',
      conflict: { level: 'REVIEW', explanationKey: 'copyleft-in-permissive-project', agplNetworkedUse: false },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).toContain('an-unusually-long-package-name'); // guard against the label line silently not being rendered at all
    for (const line of output.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('renders the dependency chain on AGPL-informational entries too, not just CONFLICT/REVIEW/UNKNOWN', () => {
    const pkg = makeResolved({
      name: 'tri-licensed', license: 'MIT OR AGPL-3.0-only', category: 'permissive',
      paths: [['app-dep', 'tri-licensed']], pathCountAtLeast: 1,
      conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).toContain('via app-dep → tri-licensed');
  });

  it('renders direct AGPL (chosen branch) as maximally prominent, inside CONFLICT', () => {
    const pkg = makeResolved({
      name: 'direct-agpl', license: 'AGPL-3.0-only', category: 'strong-copyleft', licenseIds: ['AGPL-3.0-only'],
      conflict: { level: 'CONFLICT', explanationKey: 'agpl-networked-use', agplNetworkedUse: true },
    });
    const output = renderSummary(baseInput({ packages: [pkg] }));
    expect(output).toMatch(/CONFLICT/);
    const conflictIdx = output.indexOf('CONFLICT');
    expect(output.slice(conflictIdx).indexOf('direct-agpl')).toBeGreaterThan(-1);
  });

  it('always renders UNKNOWN packages, never buries them, and shows the count in the summary line', () => {
    const unknowns = Array.from({ length: 3 }, (_, i) => makeResolved({ name: `mystery-${i}`, license: 'UNKNOWN', category: 'unknown', source: 'none', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } }));
    const output = renderSummary(baseInput({ packages: unknowns }));
    expect(output).toMatch(/UNKNOWN/);
    expect(output).toMatch(/3\s+unknown/i);
    for (const pkg of unknowns) expect(output).toContain(pkg.name);
  });

  it('respects colorEnabled: false — no ANSI escape codes anywhere', () => {
    const pkg = makeResolved({ conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false } });
    const output = renderSummary(baseInput({ packages: [pkg], colorEnabled: false }));
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[/);
  });

  it('emits ANSI codes when colorEnabled: true', () => {
    const pkg = makeResolved({ conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false } });
    const output = renderSummary(baseInput({ packages: [pkg], colorEnabled: true }));
    // eslint-disable-next-line no-control-regex
    expect(output).toMatch(/\x1b\[/);
  });

  it('contains zero emoji characters', () => {
    const pkg = makeResolved({ conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false } });
    const output = renderSummary(baseInput({ packages: [pkg], colorEnabled: true }));
    // eslint-disable-next-line no-misleading-character-class
    expect(output).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('includes category totals', () => {
    const pkgs = [
      makeResolved({ name: 'a', category: 'permissive' }),
      makeResolved({ name: 'b', category: 'strong-copyleft', conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false } }),
    ];
    const output = renderSummary(baseInput({ packages: pkgs }));
    expect(output.toLowerCase()).toContain('permissive');
    expect(output.toLowerCase()).toContain('strong-copyleft');
  });

  it('includes warnings when present', () => {
    const output = renderSummary(baseInput({ warnings: ['test warning text'] }));
    expect(output).toContain('test warning text');
  });

  it('does NOT append a per-ecosystem breakdown for a single-ecosystem scan (no regression, no redundant "(npm: N)")', () => {
    const pkgs = [makeResolved({ name: 'a' }), makeResolved({ name: 'b' })];
    const output = renderSummary(baseInput({ packages: pkgs }));
    expect(output).toMatch(/2\s+packages scanned/);
    expect(output).not.toContain('(npm:');
    expect(output).not.toContain('pypi:');
  });

  it('appends per-ecosystem package counts to the scanned-count line for a mixed npm+pypi scan', () => {
    const pkgs = [
      makeResolved({ name: 'express', ecosystem: 'npm' }),
      makeResolved({ name: 'body-parser', ecosystem: 'npm' }),
      makeResolved({ name: 'requests', ecosystem: 'pypi', installPath: 'requests-2.31.0.dist-info', category: 'unknown', source: 'none', license: 'UNKNOWN', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } }),
    ];
    const output = renderSummary(baseInput({ packages: pkgs }));
    const flat = output.replace(/\s+/g, ' ');
    // npm listed before pypi (fixed reading order), values reflect real counts.
    expect(flat).toContain('(npm: 2, pypi: 1)');
  });

  it('keeps the mixed-ecosystem scanned-count line under 80 columns (wraps rather than overflowing — the M3 rendering-fidelity lesson)', () => {
    // A realistic mixed scan with multi-digit counts across both ecosystems:
    // the base "N packages scanned — ..." line plus the "(npm: A, pypi: B)"
    // suffix comfortably exceeds 80 columns, so it MUST wrap, not overflow.
    const npmPkgs = Array.from({ length: 128 }, (_, i) =>
      makeResolved({ name: `npm-pkg-${i}`, ecosystem: 'npm' }),
    );
    const pypiPkgs = Array.from({ length: 96 }, (_, i) =>
      makeResolved({ name: `pypi-pkg-${i}`, ecosystem: 'pypi', installPath: `pkg-${i}.dist-info`, category: 'unknown', source: 'none', license: 'UNKNOWN', conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false } }),
    );
    const output = renderSummary(baseInput({ packages: [...npmPkgs, ...pypiPkgs] }));
    for (const line of output.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    // The breakdown content survives the wrap (whitespace-normalized so a wrap
    // boundary between tokens doesn't hide it).
    const flat = output.replace(/\s+/g, ' ');
    expect(flat).toContain('(npm: 128, pypi: 96)');
    expect(flat).toContain('224 packages scanned');
  });
});
