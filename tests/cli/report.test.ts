import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runReport } from '../../src/cli/report';
import { findChromeExecutable } from '../../src/report/pdf';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');
const NPM_FIXTURE = path.join(FIXTURES, 'package-lock-v3-basic');

// A real, verifying license key (M6 Task 1). These tests exercise the report
// output-path/validation machinery, all of which requires an unlocked (keyed)
// request for the gated formats (html/pdf/notices/sbom-spdx) since Milestone 6.
// Dedicated gating behavior (refusal, exit 3, whole-request semantics) lives in
// reportGating.test.ts; here we just supply a valid key so the path machinery
// under test actually runs. Gating for these formats is proven separately.
const KEY =
  'eyJwcm9kdWN0IjoibGljZW5zZXByb29mIiwidGllciI6ImluZGl2aWR1YWwiLCJsaWNlbnNlSWQiOiJFOVlNM0FVTVdDIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTIyVDIzOjI0OjM1LjY1MFoiLCJ1cGRhdGVzVW50aWwiOiIyMDI3LTA3LTIyVDIzOjI0OjM1LjY1MFoifQ.6dXrjjkhjtIvO3wdIjVqevO3NiJ6bKIK9exRmeMirkxPBaNYhc-pN9TQ4XStr1bKacTspX5VKU7btgNsC2tKDQ';

describe('runReport — output-path resolution + plumbing', () => {
  let scratch: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-report-'));
  });

  afterEach(() => {
    process.chdir(originalCwd); // some tests chdir into scratch to exercise the default-dir path
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('single format + explicit --out <file>: honors the literal path', async () => {
    const target = path.join(scratch, 'custom-name.html');
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['html'], out: target, key: KEY });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toContain('<!DOCTYPE html>');
    // No default-named file should exist alongside it.
    expect(fs.existsSync(path.join(scratch, 'report.html'))).toBe(false);
  });

  it('single format + no --out: writes to ./licenseproof-report/ (relative to cwd)', async () => {
    process.chdir(scratch);
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['html'], key: KEY });
    expect(result.exitCode).toBe(0);
    const expected = path.join(scratch, 'licenseproof-report', 'report.html');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('multiple formats + --out <dir>: all artifacts land in that dir with default names', async () => {
    const outDir = path.join(scratch, 'artifacts');
    const result = await runReport({
      path: NPM_FIXTURE,
      productionOnly: true,
      formats: ['html', 'notices', 'sbom-cyclonedx', 'sbom-spdx'],
      out: outDir,
      key: KEY,
    });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(outDir, 'report.html'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'sbom.cyclonedx.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'sbom.spdx.json'))).toBe(true);
  });

  it('multiple formats + no --out: default dir holds all default-named artifacts', async () => {
    process.chdir(scratch);
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['html', 'notices'], key: KEY });
    expect(result.exitCode).toBe(0);
    const dir = path.join(scratch, 'licenseproof-report');
    expect(fs.existsSync(path.join(dir, 'report.html'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'THIRD_PARTY_NOTICES.txt'))).toBe(true);
  });

  // Since Task 3 this drives a REAL Chrome render through the whole CLI path
  // (it previously hit a stub renderer), so it is gated on a browser actually
  // being installed. Without one, `report --format pdf` correctly exits 2 with
  // the honest "no browser found" message instead of writing a file — that path
  // is covered in tests/report/pdfNoBrowser.test.ts, which simulates the
  // no-browser case on any machine.
  it.skipIf(!findChromeExecutable())(
    'writes the PDF as valid binary bytes (Buffer write path), not text',
    async () => {
      const target = path.join(scratch, 'out.pdf');
      const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['pdf'], out: target, key: KEY });
      expect(result.exitCode).toBe(0);
      const bytes = fs.readFileSync(target);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.subarray(-6).toString('latin1')).toContain('%%EOF');
    },
    60_000, // real browser launch + print; well above the 20s global default
  );
});

describe('runReport — format validation', () => {
  let scratch: string;
  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-report-'));
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('rejects an unknown format with a clear error naming the bad value + valid set, exit 2, nothing written', async () => {
    const outDir = path.join(scratch, 'should-not-exist');
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['html', 'bogus'], out: outDir });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('bogus');
    expect(result.output).toContain('sbom-cyclonedx'); // names the valid set
    // Validation happens before any scan/write, so no output dir/files were created.
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it('rejects an empty format request (exit 2)', async () => {
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: [] });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('at least one --format');
  });

  it('de-duplicates repeated formats (writes each artifact once)', async () => {
    const outDir = path.join(scratch, 'dedupe');
    const result = await runReport({ path: NPM_FIXTURE, productionOnly: true, formats: ['html', 'html'], out: outDir, key: KEY });
    expect(result.exitCode).toBe(0);
    // Message reports one artifact, not two.
    expect(result.output).toContain('wrote 1 report artifact');
  });
});

describe('runReport — no project detected', () => {
  it('exits 2 with a report-specific message naming both npm and Python markers, nothing written', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-empty-'));
    try {
      // Supply a valid key so the request passes the license gate and reaches
      // the no-project detection (exit 2). Without a key, a gated-format request
      // is refused at the gate first (exit 3) — that precedence is covered in
      // reportGating.test.ts.
      const result = await runReport({ path: emptyDir, productionOnly: true, formats: ['html'], out: path.join(emptyDir, 'out.html'), key: KEY });
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain('report'); // extended to mention the report command
      expect(result.output).toContain('package.json');
      expect(result.output.toLowerCase()).toContain('pyproject.toml');
      expect(fs.existsSync(path.join(emptyDir, 'out.html'))).toBe(false);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
