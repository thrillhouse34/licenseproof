import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { runScan } from '../../src/cli/scan';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

describe('runScan', () => {
  it('exits 0 and returns a summary string for a normal project', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'package-lock-v3-basic'), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('fixture-package-lock-v3');
  });

  it('returns valid JSON dumping the normalized tree when format is json', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'package-lock-v3-basic'), productionOnly: true, format: 'json', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.projectName).toBe('fixture-package-lock-v3');
    expect(Array.isArray(parsed.packages)).toBe(true);
  });

  it('exits 2 with a one-line message (no stack trace) when the path has no package.json', async () => {
    const result = await runScan({ path: require('os').tmpdir(), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(2);
    expect(result.output).not.toContain('at Object.'); // no stack trace leaked
    expect(result.output.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('exits 0 by default when only REVIEW/UNKNOWN packages exist (no CONFLICT)', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'resolve-03-missing-license'), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
  });

  it('--fail-on review exits 1 when a REVIEW/UNKNOWN package exists, even with no CONFLICT', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'resolve-03-missing-license'), productionOnly: true, format: 'summary', failOn: 'review', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(1);
  });

  it('--fail-on never always exits 0 regardless of conflicts', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'resolve-04-deprecated-id'), productionOnly: true, format: 'summary', failOn: 'never', projectLicenseOverride: 'proprietary' });
    expect(result.exitCode).toBe(0);
  });

  it('default --fail-on conflict exits 1 when a CONFLICT package exists', async () => {
    const result = await runScan({ path: path.join(FIXTURES, 'resolve-04-deprecated-id'), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: 'proprietary' });
    expect(result.exitCode).toBe(1);
  });

  it('a tool/runtime error (no package.json) exits 2, not 1', async () => {
    const result = await runScan({ path: require('os').tmpdir(), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(2);
  });

  it('the no-project message names both npm and Python markers', async () => {
    const result = await runScan({ path: require('os').tmpdir(), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.output).toContain('package.json');
    expect(result.output.toLowerCase()).toContain('pyproject.toml');
  });
});

describe('runScan — multi-ecosystem (npm + pypi) merge', () => {
  const MIXED = path.join(FIXTURES, 'mixed-npm-pypi');

  it('detects and scans BOTH ecosystems, merging packages into one report', async () => {
    const result = await runScan({ path: MIXED, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.output);
    // 2 npm (express, body-parser) + 2 pypi (requests, click) pinned.
    expect(report.summary.byEcosystem).toEqual({ npm: 2, pypi: 2 });
    expect(report.summary.totalPackages).toBe(4);
    const names = report.packages.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['body-parser', 'click', 'express', 'requests']);
  });

  it('renders per-ecosystem counts in the terminal summary line', async () => {
    const result = await runScan({ path: MIXED, productionOnly: false, format: 'summary', failOn: 'never', projectLicenseOverride: undefined, colorEnabled: false });
    const flat = result.output.replace(/\s+/g, ' ');
    expect(flat).toContain('(npm: 2, pypi: 2)');
    // every rendered line stays within 80 columns
    for (const line of result.output.split('\n')) {
      // warnings are intentionally unwrapped (pre-existing behavior); the
      // scanned-count header line is the one under test here.
      if (line.trim().startsWith('-')) continue;
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it('applies the mixed-repo project-license tie-break (npm-declared wins) and warns non-silently', async () => {
    const result = await runScan({ path: MIXED, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    const report = JSON.parse(result.output);
    // package.json declares MIT, pyproject.toml declares Apache-2.0 → npm wins.
    expect(report.projectLicense.id).toBe('MIT');
    expect(report.warnings.some((w: string) => w.includes('package.json (MIT)') && w.includes('pyproject.toml (Apache-2.0)'))).toBe(true);
  });

  it('--project-license overrides the tie-break entirely', async () => {
    const result = await runScan({ path: MIXED, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: 'Apache-2.0' });
    const report = JSON.parse(result.output);
    expect(report.projectLicense.id).toBe('Apache-2.0');
  });
});

describe('runScan — richer mixed npm+pypi project (Task 8 fixture #9, real node_modules + real .venv)', () => {
  // Supersedes fixtures/mixed-npm-pypi (Task 7's lean 4-file merge proof, no
  // node_modules/.venv, everything resolves UNKNOWN on the pypi side) with a
  // genuinely realistic small project: 3 npm packages (a real package-lock.json
  // + real node_modules/<pkg>/package.json dirs so diskPath resolves) side by
  // side with 3 pypi packages (a real requirements.txt + a real .venv
  // site-packages layout with real dist-info METADATA, exercising all three
  // PyPI resolution signals: License-Expression/expression, a free-text
  // License field falling through to a Trove classifier, and a clean
  // License-Expression with no classifier at all).
  const MIXED_FULL = path.join(FIXTURES, 'mixed-npm-pypi-full');

  it('detects and scans BOTH ecosystems, merging all 6 packages with correct per-ecosystem counts', async () => {
    const result = await runScan({ path: MIXED_FULL, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.output);
    expect(report.summary.byEcosystem).toEqual({ npm: 3, pypi: 3 });
    expect(report.summary.totalPackages).toBe(6);
    const names = report.packages.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['body-parser', 'click', 'express', 'idna', 'prettier', 'requests']);
  });

  it('resolves a REAL license for every package on both sides (no UNKNOWNs) via diskPath-backed metadata', async () => {
    const result = await runScan({ path: MIXED_FULL, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    const report = JSON.parse(result.output);
    expect(report.summary.unknownCount).toBe(0);
    expect(report.summary.conflictCount).toBe(0);
    const byName: Record<string, (typeof report.packages)[number]> = Object.fromEntries(
      report.packages.map((p: { name: string }) => [p.name, p]),
    );
    // npm side: license comes straight from package-lock.json's "license" field.
    expect(byName['express'].license).toBe('MIT');
    expect(byName['express'].source).toBe('metadata');
    expect(byName['express'].hasDiskPath).toBe(true);
    expect(byName['body-parser'].license).toBe('MIT');
    expect(byName['body-parser'].hasDiskPath).toBe(true);
    expect(byName['prettier'].license).toBe('MIT');
    expect(byName['prettier'].dev).toBe(true);
    expect(byName['prettier'].hasDiskPath).toBe(true);
    // pypi side, all three resolution paths represented:
    // requests: free-text "License: Apache 2.0" doesn't parse as SPDX, falls
    // through to the "License :: OSI Approved :: Apache Software License"
    // classifier -> Apache-2.0, source 'classifier'.
    expect(byName['requests'].license).toBe('Apache-2.0');
    expect(byName['requests'].source).toBe('classifier');
    expect(byName['requests'].hasDiskPath).toBe(true);
    // click: clean PEP 639 License-Expression, agreeing classifier present ->
    // source 'expression', no disagreement bump.
    expect(byName['click'].license).toBe('BSD-3-Clause');
    expect(byName['click'].source).toBe('expression');
    expect(byName['click'].conflict.level).toBe('NONE');
    expect(byName['click'].hasDiskPath).toBe(true);
    // idna: clean PEP 639 License-Expression, no classifier at all.
    expect(byName['idna'].license).toBe('BSD-3-Clause');
    expect(byName['idna'].source).toBe('expression');
    expect(byName['idna'].hasDiskPath).toBe(true);
  });

  it('tags each per-package JSON entry with its own ecosystem (Milestone 5 P2), not just the aggregate byEcosystem counts', async () => {
    const result = await runScan({ path: MIXED_FULL, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    const report = JSON.parse(result.output);
    const byName: Record<string, { ecosystem: string }> = Object.fromEntries(
      report.packages.map((p: { name: string; ecosystem: string }) => [p.name, p]),
    );
    expect(byName['express'].ecosystem).toBe('npm');
    expect(byName['body-parser'].ecosystem).toBe('npm');
    expect(byName['prettier'].ecosystem).toBe('npm');
    expect(byName['requests'].ecosystem).toBe('pypi');
    expect(byName['click'].ecosystem).toBe('pypi');
    expect(byName['idna'].ecosystem).toBe('pypi');
  });

  it('excludes the npm dev dependency under productionOnly, keeps all pypi deps (requirements.txt is flat/direct)', async () => {
    const result = await runScan({ path: MIXED_FULL, productionOnly: true, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    const report = JSON.parse(result.output);
    const names = report.packages.map((p: { name: string }) => p.name).sort();
    expect(names).not.toContain('prettier');
    expect(names).toEqual(['body-parser', 'click', 'express', 'idna', 'requests']);
  });
});

describe('runScan — Milestone 4 DoD dogfood fixture (this repo\'s own package.json/lockfile + a real uv.lock)', () => {
  // fixtures/pypi-dogfood-mixed/ is the specific combined fixture the M4 plan's
  // Definition of done calls for: THIS repo's own package.json + package-lock.json
  // (copied verbatim, no node_modules — diskPath-undefined npm degradation is
  // already covered by other fixtures) side by side with a real, small,
  // unmodified uv.lock + pyproject.toml vendored from astral-sh/ruff (31
  // [[package]] entries, no .venv — diskPath-undefined pypi degradation is
  // likewise already covered elsewhere). The point of this fixture is proving
  // detection + merge + counts on a genuinely real combined project, not
  // re-proving disk resolution.
  const DOGFOOD = path.join(FIXTURES, 'pypi-dogfood-mixed');

  it('detects and scans BOTH ecosystems with --include-dev (ruff itself declares zero production deps, so the pypi side is legitimately all-dev)', async () => {
    const result = await runScan({ path: DOGFOOD, productionOnly: false, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.output);
    expect(report.summary.byEcosystem.npm).toBeGreaterThan(0);
    expect(report.summary.byEcosystem.pypi).toBeGreaterThan(0);
    // This repo's real npm dependency count (4 prod + dev tree) and ruff's real
    // uv.lock package count (31 entries minus the root "ruff" project entry
    // itself = 30 real dependency packages).
    expect(report.summary.byEcosystem.pypi).toBe(30);
    expect(report.summary.totalPackages).toBe(report.summary.byEcosystem.npm + report.summary.byEcosystem.pypi);
  });

  it('legitimately shows npm-only under the --production-only default, since ruff has no runtime dependencies of its own', async () => {
    // Documents WHY the default run is lopsided (not a bug): ruff's pyproject.toml
    // declares no [project.dependencies] at all (it's a compiled Rust binary), so
    // every uv.lock package is reachable only via its dev/release dependency
    // groups. Under productionOnly, pypi legitimately contributes 0 packages and
    // is correctly absent from byEcosystem entirely (see src/report/json.ts,
    // which only adds a key for ecosystems with >=1 package).
    const result = await runScan({ path: DOGFOOD, productionOnly: true, format: 'json', failOn: 'never', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.output);
    expect(report.summary.byEcosystem.npm).toBeGreaterThan(0);
    expect(report.summary.byEcosystem.pypi).toBeUndefined();
  });

  it('runs the full CLI pipeline without crashing and renders per-ecosystem counts in the terminal summary, wrapped within 80 columns', async () => {
    const result = await runScan({
      path: DOGFOOD, productionOnly: false, format: 'summary', failOn: 'never',
      projectLicenseOverride: undefined, colorEnabled: false,
    });
    expect(result.exitCode).toBe(0);
    const flat = result.output.replace(/\s+/g, ' ');
    expect(flat).toContain('(npm: 49, pypi: 30)');
    for (const line of result.output.split('\n')) {
      // Warnings are intentionally unwrapped (pre-existing behavior, see the
      // other mixed-ecosystem describe block above).
      if (line.trim().startsWith('-')) continue;
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('runScan — NO_COLOR environment variable', () => {
  const ORIGINAL_NO_COLOR = process.env.NO_COLOR;
  const ORIGINAL_ISTTY = process.stdout.isTTY;

  afterEach(() => {
    if (ORIGINAL_NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = ORIGINAL_NO_COLOR;
    (process.stdout as any).isTTY = ORIGINAL_ISTTY;
  });

  it('disables color when NO_COLOR is set, even if stdout is a TTY and colorEnabled is not explicitly passed', async () => {
    (process.stdout as any).isTTY = true;
    process.env.NO_COLOR = '1';
    const result = await runScan({
      path: path.join(FIXTURES, 'package-lock-v3-basic'), productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: undefined,
    });
    // eslint-disable-next-line no-control-regex
    expect(result.output).not.toMatch(/\x1b\[/);
  });

  it('NO_COLOR set to empty string still disables color (presence, not value, per the NO_COLOR spec)', async () => {
    (process.stdout as any).isTTY = true;
    process.env.NO_COLOR = '';
    const result = await runScan({
      path: path.join(FIXTURES, 'package-lock-v3-basic'), productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: undefined,
    });
    // eslint-disable-next-line no-control-regex
    expect(result.output).not.toMatch(/\x1b\[/);
  });

  it('an explicit colorEnabled: true override still wins even with NO_COLOR set (opts.colorEnabled takes precedence)', async () => {
    process.env.NO_COLOR = '1';
    const result = await runScan({
      path: path.join(FIXTURES, 'package-lock-v3-basic'), productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: undefined, colorEnabled: true,
    });
    // eslint-disable-next-line no-control-regex
    expect(result.output).toMatch(/\x1b\[/);
  });
});

// licenseproof has no --config flag; the path it takes explicitly is the
// `[path]` argument. A path that isn't on disk at all used to come back as the
// marker-listing "no supported project found at X (looked for package.json,
// and pyproject.toml / ...)" — which sent people hunting for a missing
// manifest in a directory that never existed. Same exit code (2), honest
// message. The guard lives in buildReportData, so `report` gets it too.
describe('runScan — a project path that does not exist', () => {
  const os = require('os');
  const fs = require('fs');

  it('exits 2 with "path not found" naming the path, not the no-manifest message', async () => {
    const missing = path.join(os.tmpdir(), 'licenseproof-no-such-dir-xyz');
    const result = await runScan({ path: missing, productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('path not found');
    expect(result.output).toContain(missing);
    expect(result.output).not.toContain('no supported project found');
  });

  it('keeps it to one line with no stack trace leaked', async () => {
    const result = await runScan({ path: path.join(os.tmpdir(), 'licenseproof-no-such-dir-xyz'), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.output).not.toContain('at Object.');
    expect(result.output.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('fails even with --fail-on never — this is a usage error, not a license verdict', async () => {
    const result = await runScan({ path: path.join(os.tmpdir(), 'licenseproof-no-such-dir-xyz'), productionOnly: true, format: 'summary', failOn: 'never', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(2);
  });

  it('a FILE passed where a directory is expected is also "path not found", not a crash', async () => {
    const f = path.join(os.tmpdir(), 'licenseproof-not-a-dir.txt');
    fs.writeFileSync(f, 'x');
    try {
      const result = await runScan({ path: f, productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain('path not found');
    } finally {
      fs.rmSync(f, { force: true });
    }
  });

  it('an existing directory with no manifest still gets the no-project message', async () => {
    const result = await runScan({ path: os.tmpdir(), productionOnly: true, format: 'summary', failOn: 'conflict', projectLicenseOverride: undefined });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('no supported project found');
  });
});
