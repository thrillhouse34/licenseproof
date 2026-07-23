import * as fs from 'fs';
import puppeteer from 'puppeteer-core';
import type { ReportData } from './reportData';

// ─────────────────────────────────────────────────────────────────────────────
// LicenseProof PDF report (Milestone 5, Task 3).
//
// The REAL renderer. It prints the Task-2 HTML report (`renderHtml`) to PDF by
// driving an ALREADY-INSTALLED Chrome / Chromium / Edge via `puppeteer-core`.
// We use `puppeteer-core` — never plain `puppeteer` — specifically because it
// does NOT download a bundled Chromium on install (verified: the installed
// package is ~8 MB with no browser binary, and `npm install` triggered no
// browser download). The user's own browser is located by `findChromeExecutable`
// and passed via `executablePath`; if none is found we throw a clear, honest
// error telling the user to use `--format html` instead.
//
// PER-PAGE FOOTER — the load-bearing distinction (do NOT "simplify" this):
// The provenance footer with a real per-page page number is produced HERE, via
// Puppeteer's `page.pdf({ displayHeaderFooter: true, footerTemplate })`. That is
// a genuinely different, actually-working mechanism from CSS `@page` margin
// boxes, which Chrome's print engine does NOT support for arbitrary injected
// text/counters. `footerTemplate` is an HTML string in which Puppeteer
// substitutes the live page number into `<span class="pageNumber"></span>`. This
// is the ONLY place the exact footer text ("LicenseProof <tool> · data <data> ·
// <timestamp> · page N") can be implemented literally and correctly. The
// standalone HTML file (Task 2) therefore carries only a STATIC provenance
// footer — true cross-browser per-page numbering is impossible in portable print
// CSS, so nobody should later try to "fix" the HTML print CSS to add it.
// ─────────────────────────────────────────────────────────────────────────────

// Standard install locations to probe, per OS. First existing file wins. The
// list is platform-gated (see `findChromeExecutable`) so we never do pointless
// `fs.existsSync` calls for paths that cannot exist on the current OS.
const MACOS_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const LINUX_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/snap/bin/chromium',
];

const WINDOWS_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

/**
 * Locate an installed Chrome / Chromium / Edge executable at a standard OS
 * location, or `undefined` if none is present. Only the current platform's
 * candidate list is probed.
 */
export function findChromeExecutable(): string | undefined {
  let candidates: string[];
  switch (process.platform) {
    case 'darwin':
      candidates = MACOS_PATHS;
      break;
    case 'win32':
      candidates = WINDOWS_PATHS;
      break;
    default:
      // Linux and every other Unix-like platform use the Linux locations.
      candidates = LINUX_PATHS;
      break;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The exact, honest message surfaced when no browser is installed. Thrown as an
 * `Error` (caught by `runReport`'s render-loop try/catch, which turns any thrown
 * error into an exit-2 tool error — matching the `scan` command's convention).
 * The same wording is documented in the README so a user who hits it in the
 * terminal and a user who reads the docs see the identical guidance.
 */
export const NO_BROWSER_MESSAGE =
  'No installed Chrome, Chromium, or Edge browser was found at any standard location. ' +
  'PDF generation requires one of these to be installed. ' +
  'Use --format html instead — no dependencies required.';

/**
 * Escape a value for safe interpolation into the footer HTML template. The
 * provenance fields (tool version, data version, ISO timestamp) never contain
 * HTML-special characters in practice, but escaping keeps the template robust if
 * that ever changes and avoids any chance of the injected text breaking the
 * footer markup.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the per-page footer template: the literal required provenance text with
 * a live page number injected into `<span class="pageNumber"></span>` (Puppeteer
 * substitutes the real per-page value into that span at print time).
 *
 * Exported so it can be unit-tested directly. That matters because the rendered
 * PDF's text is NOT greppable: Chrome subsets its fonts and encodes text as
 * glyph indices inside Flate-compressed content streams, so the footer string
 * cannot be recovered from the output bytes without a full PDF-parsing library
 * (deliberately not added for this). Testing the template we hand to Puppeteer,
 * plus asserting the PDF really is a valid multi-page document, is the sound
 * split: the exact wording is ours to get right and is tested here, while
 * substituting `pageNumber` is Puppeteer's documented contract.
 *
 * A wrapping div with an explicit font-size is REQUIRED — Puppeteer's default
 * header/footer font-size is effectively 0, so an unstyled template renders
 * invisibly.
 */
export function buildFooterTemplate(data: ReportData): string {
  return (
    `<div style="width:100%;font-size:8px;color:#5b6472;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `padding:0 14mm;text-align:center;">` +
    `LicenseProof ${escapeHtml(data.toolVersion)} &middot; ` +
    `data ${escapeHtml(data.dataVersion)} &middot; ` +
    `${escapeHtml(data.scanTimestamp)} &middot; ` +
    `page <span class="pageNumber"></span>` +
    `</div>`
  );
}

/**
 * Render the already-produced HTML report to a PDF Buffer.
 *
 * Signature decision — takes BOTH the rendered `html` string AND the `data`:
 *   - `html` is what Puppeteer actually prints. Puppeteer prints HTML, not
 *     `ReportData`, so the renderer must receive the HTML the Task-2 renderer
 *     produced (the call site composes `renderPdf(renderHtml(data), data)`).
 *   - `data` is needed ONLY for the footer's provenance text (toolVersion,
 *     dataVersion, scanTimestamp). Re-deriving these from the HTML string would
 *     be brittle string-scraping; passing the structured data is clean and
 *     keeps this function from having to know anything about the HTML's shape.
 * Taking both (rather than taking `ReportData` and calling `renderHtml`
 * internally) keeps `renderPdf` a focused "print this HTML" function with no
 * dependency on the HTML renderer, and avoids rendering the HTML twice.
 *
 * Throws `Error(NO_BROWSER_MESSAGE)` if no browser is installed.
 */
export async function renderPdf(html: string, data: ReportData): Promise<Buffer> {
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error(NO_BROWSER_MESSAGE);
  }

  const footerTemplate = buildFooterTemplate(data);

  // An empty (but non-empty-string) header suppresses Chrome's built-in default
  // header (date + document title) that would otherwise appear whenever
  // displayHeaderFooter is true and no headerTemplate is supplied.
  const headerTemplate = '<div></div>';

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    // WAIT CONDITION — deviates from the plan's `networkidle0` for a real API
    // reason, not a shortcut: puppeteer-core v25's `setContent` type EXPLICITLY
    // excludes the networkidle values
    // (`Exclude<PuppeteerLifeCycleEvent, 'networkidle0' | 'networkidle2'>`, see
    // SetContentWaitForOptions in its types.d.ts) — upstream removed them from
    // setContent because network-idle semantics are meaningless for content set
    // directly rather than navigated to. `'load'` is the accepted value and the
    // correct one here: it waits for the document and all its resources, which
    // for this fully self-contained, zero-external-request report resolves
    // immediately while still being the strongest guarantee the API offers.
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      // Bottom margin is the largest to leave room for the footer band; the rest
      // match the HTML's own ~16mm print margins.
      margin: { top: '16mm', bottom: '20mm', left: '14mm', right: '14mm' },
    });
    // page.pdf() returns a Uint8Array in puppeteer-core v25; the CLI writes a
    // Buffer, so normalize here.
    return Buffer.from(pdf);
  } finally {
    // Always close the browser, even if setContent/pdf threw.
    await browser.close();
  }
}
