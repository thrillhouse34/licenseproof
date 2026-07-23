import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pypiEcosystem } from '../../../src/ecosystems/pypi';
import { runScan } from '../../../src/cli/scan';

/**
 * Task 8 fixture #10: one real-world lockfile from a known OSS Python project,
 * vendored verbatim (not synthetic, not hand-written) — same rationale as
 * npm's M1 diamond-graph perf fixture, but for a REAL messy real-world
 * uv.lock rather than a generated worst-case shape.
 *
 * Source: pallets/flask's own `uv.lock` + `pyproject.toml`, fetched from
 * `raw.githubusercontent.com/pallets/flask/main/{uv.lock,pyproject.toml}`
 * during this development session (a one-time vendoring action — the SHIPPED
 * tool never fetches anything over the network, see foundations_addendum.md
 * §4 / the plan's Global Constraints). Files are checked in byte-for-byte as
 * fetched. 83 `[[package]]` blocks in the raw lockfile (root `flask` entry
 * itself + 2 environment-marker-split duplicate blocks for sphinx /
 * sphinx-autobuild + 78 distinct resolved dependencies), landing squarely in
 * the plan's "reasonable, genuinely-real ~80-100 package uv.lock" guidance —
 * smaller than M1's synthetic 3000-package fixture by design (that fixture
 * was about proving buildPaths doesn't blow up on a diamond-heavy graph, not
 * raw package count; this fixture is about proving the PARSER survives a
 * real, messy, hand-authored-by-a-large-OSS-project lockfile without
 * crashing, timing out, or mis-collapsing a genuine marker split).
 *
 * No `.venv` is included here on purpose (per the plan: "no .venv needed for
 * this one — the point is proving the parser handles a real, large, messy
 * real-world lockfile without crashing or timing out, not diskPath
 * resolution"). Every package therefore resolves to UNKNOWN (no license
 * signal) — that is the EXPECTED, disclosed outcome for this fixture, not a
 * bug; diskPath/license-resolution behavior is already covered by
 * fixtures/pypi-uv-basic (Task 5) and the METADATA-driven fixtures (Task 6).
 */
describe('fixtures/pypi-real-world-perf — real pallets/flask uv.lock, parser resilience + perf', () => {
  const FIXTURE = path.join(__dirname, '..', '..', '..', 'fixtures', 'pypi-real-world-perf');

  it('parses the real lockfile successfully and produces a sane package count', async () => {
    const result = await pypiEcosystem.scan(FIXTURE, { productionOnly: false });
    expect(result.lockfile).toBe('uv-lock');
    expect(result.ecosystems).toEqual(['pypi']);
    // 78 distinct resolved dependencies (root flask entry excluded; sphinx +
    // sphinx-autobuild each collapse from 2 marker-split blocks to 1 name).
    expect(result.packages.length).toBe(78);
    // Spot-check a few real, known Flask dependencies actually resolved.
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('click');
    expect(names).toContain('jinja2');
    expect(names).toContain('werkzeug');
    expect(names).toContain('markupsafe');
    expect(names).toContain('blinker');
    expect(names).toContain('itsdangerous');
  });

  it('reads the project name/license from the real pyproject.toml ("Flask" / BSD-3-Clause)', async () => {
    const result = await pypiEcosystem.scan(FIXTURE, { productionOnly: false });
    expect(result.projectName).toBe('Flask');
    expect(result.projectLicenseRaw).toBe('BSD-3-Clause');
  });

  it('discloses the real marker-based version collapse (sphinx / sphinx-autobuild), never silently', async () => {
    const result = await pypiEcosystem.scan(FIXTURE, { productionOnly: false });
    const warning = result.warnings.find((w) => w.includes('more than one [[package]] block'));
    expect(warning).toBeDefined();
    expect(warning).toContain('sphinx');
    expect(warning).toContain('sphinx-autobuild');
  });

  it('parses well under a reasonable time bound (real 78-package graph, not a timeout risk)', async () => {
    const start = Date.now();
    const result = await pypiEcosystem.scan(FIXTURE, { productionOnly: false });
    const elapsed = Date.now() - start;
    expect(result.packages.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });

  it('runs end-to-end through the real CLI pipeline (runScan, JSON format) without crashing', async () => {
    const start = Date.now();
    const result = await runScan({
      path: FIXTURE,
      productionOnly: false,
      format: 'json',
      failOn: 'never',
      projectLicenseOverride: undefined,
    });
    const elapsed = Date.now() - start;
    expect(result.exitCode).toBe(0);
    expect(elapsed).toBeLessThan(2000);
    const report = JSON.parse(result.output);
    expect(report.projectName).toBe('Flask');
    expect(report.projectLicense).toEqual({ id: 'BSD-3-Clause', wasUnspecified: false });
    expect(report.summary.totalPackages).toBe(78);
    // No .venv in this fixture (by design) — every package lacks a license
    // signal and resolves UNKNOWN, never a crash or a false CONFLICT.
    expect(report.summary.unknownCount).toBe(78);
    expect(report.summary.conflictCount).toBe(0);
  });
});
