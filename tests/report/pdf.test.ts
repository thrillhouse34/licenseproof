// Real-environment tests: the actual installed browser (if any), the footer
// template, and genuine Chrome-driven renders. The cases that need a SIMULATED
// filesystem (platform gating, first-match-wins, the no-browser error) live in
// pdfNoBrowser.test.ts, which mocks `fs` wholesale — `vi.spyOn(fs,'existsSync')`
// is not usable here because Node's fs exports are non-configurable.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderPdf, findChromeExecutable, buildFooterTemplate, NO_BROWSER_MESSAGE } from '../../src/report/pdf';
import { renderHtml } from '../../src/report/html';
import { buildReportData } from '../../src/report/reportData';
import type { ReportData } from '../../src/report/reportData';

// Whether THIS machine has a real browser. Every test that actually drives
// Chrome is gated on it, so the suite stays green (with an explicit skip, never
// a silent pass) on a machine or CI runner without one. This is a legitimate
// environment-dependent test, not a flaky one being papered over.
const CHROME = findChromeExecutable();

// Real browser launch + print is slower than a normal unit test (cold start can
// take several seconds), so the render tests get their own generous timeout
// rather than relying on the 20s global default.
const RENDER_TIMEOUT = 60_000;

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    projectName: 'my-app',
    packages: [],
    warnings: [],
    projectLicense: { id: 'proprietary', wasUnspecified: false },
    toolVersion: '0.2.0',
    dataVersion: '2026.07.21',
    scanTimestamp: '2026-07-21T12:00:00.000Z',
    ecosystems: ['npm'],
    ...overrides,
  };
}

describe('findChromeExecutable', () => {
  it('returns undefined or a path that really exists on disk', () => {
    const found = findChromeExecutable();
    if (found === undefined) return; // no browser on this machine — a valid result
    expect(fs.existsSync(found)).toBe(true);
    expect(path.isAbsolute(found)).toBe(true);
  });
});

describe('NO_BROWSER_MESSAGE', () => {
  it('names Chrome, Chromium and Edge and points at the --format html fallback', () => {
    // The message is a user-facing contract, also documented verbatim in the README.
    expect(NO_BROWSER_MESSAGE).toContain('Chrome');
    expect(NO_BROWSER_MESSAGE).toContain('Chromium');
    expect(NO_BROWSER_MESSAGE).toContain('Edge');
    expect(NO_BROWSER_MESSAGE).toContain('--format html');
  });
});

describe('buildFooterTemplate', () => {
  it('renders the exact required provenance text with a live page-number span', () => {
    const footer = buildFooterTemplate(baseData());

    // The literal required footer text: "LicenseProof <tool> · data <data> · <timestamp> · page N".
    // `&middot;` is the HTML entity for the separator, and `pageNumber` is the
    // span Puppeteer substitutes the real per-page value into.
    expect(footer).toContain('LicenseProof 0.2.0 &middot; data 2026.07.21 &middot; 2026-07-21T12:00:00.000Z &middot; page ');
    expect(footer).toContain('<span class="pageNumber"></span>');
  });

  it('sets an explicit font-size (Puppeteer footers default to an invisible size)', () => {
    // Without an explicit font-size the footer renders at effectively 0px and is
    // invisible in the output — a real, easy-to-regress Puppeteer gotcha.
    expect(buildFooterTemplate(baseData())).toMatch(/font-size:\s*\d+px/);
  });

  it('escapes HTML-special characters in the provenance values', () => {
    const footer = buildFooterTemplate(baseData({ toolVersion: '1.0<script>' }));
    expect(footer).toContain('1.0&lt;script&gt;');
    expect(footer).not.toContain('<script>');
  });
});

describe('renderPdf — real Chrome render', () => {
  it.skipIf(!CHROME)(
    'prints a real fixture end-to-end into a valid, multi-page A4 PDF',
    async () => {
      const data = await buildReportData(
        path.join(__dirname, '../../fixtures/resolve-08-conflict-matrix'),
        { productionOnly: false },
      );
      const pdf = await renderPdf(renderHtml(data), data);

      expect(Buffer.isBuffer(pdf)).toBe(true);

      // Valid PDF magic header + proper end-of-file marker.
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');

      // A real rendered report, not a stub: the old Task-1 placeholder was ~1KB.
      expect(pdf.length).toBeGreaterThan(20_000);

      // Plausible page count without a PDF-parsing dependency: the page tree's
      // /Count must be >= 2 (this fixture's report genuinely spans several
      // pages), which is also what makes the per-page footer meaningful.
      const raw = pdf.toString('latin1');
      const count = raw.match(/\/Count\s+(\d+)/);
      expect(count, 'PDF declares a page count').not.toBeNull();
      expect(Number(count![1])).toBeGreaterThanOrEqual(2);

      // A4 is 595.28 x 841.89 pt — assert the MediaBox really is A4-sized
      // (proves format:'A4' took effect rather than defaulting to Letter).
      const mediaBox = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(mediaBox, 'PDF declares a MediaBox').not.toBeNull();
      expect(Math.round(Number(mediaBox![1]))).toBeGreaterThanOrEqual(595);
      expect(Math.round(Number(mediaBox![1]))).toBeLessThanOrEqual(596);
      expect(Math.round(Number(mediaBox![2]))).toBeGreaterThanOrEqual(841);
      expect(Math.round(Number(mediaBox![2]))).toBeLessThanOrEqual(842);
    },
    RENDER_TIMEOUT,
  );

  it.skipIf(!CHROME)(
    'produces a valid PDF for a report with no findings at all',
    async () => {
      // An empty/clean report is a real case (a project with zero flagged
      // packages) and must still print a valid document, not an empty file.
      const pdf = await renderPdf(renderHtml(baseData()), baseData());
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1_000);
    },
    RENDER_TIMEOUT,
  );
});
