import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderHtml } from '../../src/report/html';
import { buildReportData } from '../../src/report/reportData';
import type { ReportData } from '../../src/report/reportData';
import type { ResolvedPackage } from '../../src/resolve/types';

const EXPLANATIONS: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../data/conflict-explanations.json'), 'utf8'),
).explanations;

function makeResolved(overrides: Partial<ResolvedPackage>): ResolvedPackage {
  return {
    name: 'pkg', version: '1.0.0', ecosystem: 'npm', direct: true, dev: false,
    paths: [['pkg']], pathCountAtLeast: 1, installPath: 'node_modules/pkg', diskPath: 'node_modules/pkg',
    license: 'MIT', licenseIds: ['MIT'], category: 'permissive', confidence: 'high', source: 'metadata',
    conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: false },
    ...overrides,
  };
}

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

// One package per non-clean severity, plus a clean one — exercises every chip.
const CONFLICT_PKG = makeResolved({
  name: 'strong-copyleft-pkg', version: '1.0.0', license: 'GPL-3.0-only', licenseIds: ['GPL-3.0-only'],
  category: 'strong-copyleft', paths: [['express', 'strong-copyleft-pkg']],
  conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false },
});
const AGPL_INFO_PKG = makeResolved({
  name: 'dual-agpl-pkg', version: '2.0.0', license: 'MIT OR AGPL-3.0-only', licenseIds: ['MIT', 'AGPL-3.0-only'],
  category: 'permissive',
  conflict: { level: 'NONE', explanationKey: null, agplNetworkedUse: true },
});
const REVIEW_PKG = makeResolved({
  name: 'lgpl-pkg', version: '3.0.0', license: 'LGPL-3.0-only', licenseIds: ['LGPL-3.0-only'],
  category: 'weak-copyleft',
  conflict: { level: 'REVIEW', explanationKey: 'weak-copyleft-review', agplNetworkedUse: false },
});
const UNKNOWN_PKG = makeResolved({
  name: 'mystery-pkg', version: '0.0.1', license: 'UNKNOWN', licenseIds: [], category: 'unknown',
  confidence: 'low', source: 'none',
  conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false },
});
const CLEAN_PKG = makeResolved({ name: 'clean-pkg', version: '4.0.0' });

const FULL_SPECTRUM = baseData({
  packages: [CONFLICT_PKG, AGPL_INFO_PKG, REVIEW_PKG, UNKNOWN_PKG, CLEAN_PKG],
});

// The section-order markers, in the exact §2 order.
const SECTION_MARKERS = [
  'License report for', // (1) cover header
  'id="exec-h"',        // (2) executive summary
  'id="findings-h"',    // (3) findings
  'id="inventory-h"',   // (4) full inventory
  'id="method-h"',      // (5) methodology appendix
  'class="provenance"', // (6) provenance footer
];

describe('renderHtml — document shape', () => {
  it('is a single self-contained HTML document with exactly one <title>', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect((html.match(/<title>/g) ?? []).length).toBe(1);
    // Exactly one inline <style> block, no external stylesheet.
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
  });

  it('renders all six sections in the exact brief order', () => {
    const html = renderHtml(FULL_SPECTRUM);
    let last = -1;
    for (const marker of SECTION_MARKERS) {
      const at = html.indexOf(marker);
      expect(at, `section marker "${marker}" present`).toBeGreaterThan(-1);
      expect(at, `section marker "${marker}" after previous`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('states tool version, data version, and scan timestamp (addendum §3)', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('0.2.0');
    expect(html).toContain('2026.07.21');
    expect(html).toContain('2026-07-21T12:00:00.000Z');
    // provenance footer carries the SPDX list version from the real manifest.
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/manifest.json'), 'utf8'));
    expect(html).toContain(manifest.spdxListVersion);
  });

  it('states the "not legal advice" scope line plainly on the cover', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('Informational license categorization — not legal advice.');
  });
});

describe('renderHtml — fully offline', () => {
  it('contains zero external references (no http(s), <link>, or <script src>)', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(/i); // no external (or data:) CSS assets
  });
});

describe('renderHtml — severity chips', () => {
  it('defines the correct color for each severity in the stylesheet', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('--sev-conflict: #b91c1c'); // red
    expect(html).toContain('--sev-review: #b45309');   // amber
    expect(html).toContain('--sev-agpl: #1e3a8a');     // blue (the one accent)
    expect(html).toContain('--sev-unknown: #6b7280');  // gray
  });

  it('renders each finding with the right chip class for its severity', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toMatch(/chip chip--conflict"[^>]*><span class="chip__dot"><\/span>Conflict/);
    expect(html).toMatch(/chip chip--agpl-informational"[^>]*><span class="chip__dot"><\/span>AGPL/);
    expect(html).toMatch(/chip chip--review"[^>]*><span class="chip__dot"><\/span>Review/);
    expect(html).toMatch(/chip chip--unknown"[^>]*><span class="chip__dot"><\/span>Unknown/);
  });

  it('uses plain CSS shapes for chips — no emoji or icon-font glyphs', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // The chip marker is a styled <span class="chip__dot">, a real CSS square.
    expect(html).toContain('class="chip__dot"');
    // No emoji anywhere in the output (covers the common severity emoji).
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
  });

  it('orders findings CONFLICT → AGPL-informational → REVIEW → UNKNOWN', () => {
    const html = renderHtml(FULL_SPECTRUM);
    const findingsStart = html.indexOf('id="findings-h"');
    const inventoryStart = html.indexOf('id="inventory-h"');
    const findings = html.slice(findingsStart, inventoryStart);
    const iConflict = findings.indexOf('chip--conflict');
    const iAgpl = findings.indexOf('chip--agpl-informational');
    const iReview = findings.indexOf('chip--review');
    const iUnknown = findings.indexOf('chip--unknown');
    expect(iConflict).toBeGreaterThan(-1);
    expect(iAgpl).toBeGreaterThan(iConflict);
    expect(iReview).toBeGreaterThan(iAgpl);
    expect(iUnknown).toBeGreaterThan(iReview);
  });
});

describe('renderHtml — explanations rendered verbatim from vendored data', () => {
  it('renders the exact conflict-explanations.json strings, not paraphrases', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // These strings contain no HTML-special characters, so they render verbatim.
    expect(html).toContain(EXPLANATIONS['strong-copyleft-in-proprietary']);
    expect(html).toContain(EXPLANATIONS['weak-copyleft-review']);
    expect(html).toContain(EXPLANATIONS['unknown-review']);
  });

  it('renders the shared AGPL-alternative note for the informational finding', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // Matches src/report/findingText.ts agplAlternativeNote — usable under the non-AGPL branch only.
    expect(html).toContain('AGPL appears as an alternative license; package usable under MIT.');
  });
});

describe('renderHtml — findings detail', () => {
  it('shows package@version, full license expression, confidence, source, and dependency chain', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('strong-copyleft-pkg&#64;1.0.0'); // &#64; not @ — see html.ts comment
    expect(html).toContain('GPL-3.0-only');
    expect(html).toContain('MIT OR AGPL-3.0-only'); // full expression preserved, not collapsed
    expect(html).toContain('via express → strong-copyleft-pkg'); // reuses formatChain phrasing
  });

  it('shows the "+at least N other paths" floor when the enumeration cap was hit', () => {
    const capped = makeResolved({
      name: 'deep-pkg', license: 'GPL-3.0-only', licenseIds: ['GPL-3.0-only'], category: 'strong-copyleft',
      paths: [['a', 'deep-pkg']], pathCountAtLeast: 4,
      conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false },
    });
    const html = renderHtml(baseData({ packages: [capped] }));
    expect(html).toContain('+at least 3 other paths');
  });
});

describe('renderHtml — full inventory table', () => {
  it('lists every package (including clean ones) sorted severity-then-name', () => {
    const html = renderHtml(FULL_SPECTRUM);
    const invStart = html.indexOf('id="inventory-h"');
    const inv = html.slice(invStart, html.indexOf('id="method-h"'));
    for (const name of ['strong-copyleft-pkg', 'dual-agpl-pkg', 'lgpl-pkg', 'mystery-pkg', 'clean-pkg']) {
      expect(inv).toContain(name);
    }
    // conflict sorts before the clean package in the table body.
    expect(inv.indexOf('strong-copyleft-pkg')).toBeLessThan(inv.indexOf('clean-pkg'));
  });
});

describe('renderHtml — collapsible sections (native <details>, zero JS)', () => {
  it('uses <details open> for the inventory and methodology, and ships no <script>', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('<details class="inventory-details" open>');
    expect(html).toContain('<details class="methodology" open>');
    expect(html).not.toContain('<script');
  });
});

describe('renderHtml — table & value wrapping CSS (visual-review regressions)', () => {
  it('never uses overflow-wrap: anywhere (it broke words mid-character)', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // `anywhere` split ordinary tokens mid-character in real rendering
    // (PACKAG/E, 5.3./0, GPL-3.0-/or-later, meta/data). It must not appear.
    expect(html).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('keeps inventory headers on one line and lets values break only when they must', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // Headers are short fixed labels — never wrap.
    expect(html).toMatch(/table\.inventory th\s*\{[^}]*white-space:\s*nowrap/);
    // Values use break-word (breaks only a word that cannot fit), not anywhere.
    expect(html).toMatch(/table\.inventory td\s*\{[^}]*overflow-wrap:\s*break-word/);
    // The cover/finding metadata values use break-word too.
    expect(html).toMatch(/\.meta-row dd\s*\{[^}]*overflow-wrap:\s*break-word/);
  });

  it('gives the inventory table a fixed layout + a colgroup so it fits the print page', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // Fixed layout is what stops one long package name from pushing the Status
    // column off the right edge of the (unscrollable) printed A4 page.
    expect(html).toMatch(/table\.inventory\s*\{[^}]*table-layout:\s*fixed/);
    // One <col> per column (8 columns), so the fixed widths are authoritative.
    const colgroup = html.slice(html.indexOf('<colgroup>'), html.indexOf('</colgroup>'));
    expect((colgroup.match(/<col\b/g) ?? []).length).toBe(8);
    // The colgroup widths must sum to exactly 100% — otherwise table-layout:fixed
    // either overflows the print page or leaves dead space on the right.
    const widths = [...colgroup.matchAll(/width:\s*(\d+)%/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(8);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('holds the fixed-vocabulary columns (Ecosystem/Confidence/Source) on one line', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // Ecosystem (npm/pypi), Confidence (high/medium/low), and Source
    // (metadata/expression/classifier/license-file/readme/none) are a CLOSED set
    // of short single-word tokens. At the narrow A4 print column, break-word alone
    // split them mid-character in the real PDF (metadata -> metada/ta, classifier
    // -> classif/ier), which reads as unfinished on a lawyer-facing artifact. They
    // must be pinned nowrap. nth-child indexes are the colgroup order:
    // 1=Package 2=Version 3=Ecosystem 4=License 5=Category 6=Confidence 7=Source
    // 8=Status. All three share one nowrap rule.
    expect(html).toMatch(
      /table\.inventory td:nth-child\(3\),\s*table\.inventory td:nth-child\(6\),\s*table\.inventory td:nth-child\(7\)\s*\{\s*white-space:\s*nowrap/,
    );
    // Category (col 5) is DELIBERATELY not pinned nowrap — its rendered labels are
    // multi-word ("strong copyleft", "noncommercial / commercial-restricted") and
    // must wrap at spaces; nowrap there would overflow the cell. Guard against a
    // future edit sweeping nth-child(5) into the nowrap rule.
    const nowrapRule =
      html.match(
        /(?:table\.inventory td:nth-child\(\d\),?\s*)+\{\s*white-space:\s*nowrap[^}]*\}/,
      )?.[0] ?? '';
    expect(nowrapRule).not.toMatch(/nth-child\(5\)/);
    expect(nowrapRule).not.toMatch(/nth-child\(1\)/); // Package stays break-word
    expect(nowrapRule).not.toMatch(/nth-child\(4\)/); // License stays break-word
  });

  it('does not split the scan timestamp across lines on the cover', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // The ISO timestamp is one indivisible token; it must be held on one line.
    expect(html).toMatch(/\.cover__facts dd\.ts\s*\{[^}]*white-space:\s*nowrap/);
    expect(html).toContain('<dd class="ts">2026-07-21T12:00:00.000Z</dd>');
  });

  it('splits the cover counts into three one-line facts (no wrapping combined label)', () => {
    const html = renderHtml(FULL_SPECTRUM);
    // The old combined "Conflicts / Review / Unknown" label wrapped to two lines
    // at A4 width and misaligned the row. Each count is now its own short fact.
    expect(html).toContain('<dt>Conflicts</dt>');
    expect(html).toContain('<dt>Review</dt>');
    expect(html).toContain('<dt>Unknown</dt>');
    expect(html).not.toContain('Conflicts / Review / Unknown');
  });
});

describe('renderHtml — executive summary "most restrictive category" wording', () => {
  // A package that resolved to UNKNOWN (license could not be identified).
  const unknownOnly = baseData({
    packages: [
      makeResolved({
        name: 'mystery', license: 'UNKNOWN', licenseIds: [], category: 'unknown',
        confidence: 'low', source: 'none',
        conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false },
      }),
    ],
  });

  it('never calls "unknown" the most restrictive category (it is an absence of info)', () => {
    const html = renderHtml(unknownOnly);
    const exec = html.slice(html.indexOf('id="exec-h"'), html.indexOf('id="findings-h"'));
    // The semantically-wrong sentence must not appear in any form.
    expect(exec).not.toMatch(/most restrictive[^.]*\bunknown\b/i);
    // When nothing could be identified, the sentence is omitted entirely.
    expect(exec).not.toContain('most restrictive');
    // But the count of unidentified packages is still stated plainly elsewhere.
    expect(exec).toContain('could not be confidently identified');
  });

  it('scopes the claim to identified packages when some are unknown', () => {
    const mixed = baseData({
      packages: [
        makeResolved({ name: 'perm', license: 'MIT', category: 'permissive' }),
        makeResolved({
          name: 'mystery', license: 'UNKNOWN', licenseIds: [], category: 'unknown',
          confidence: 'low', source: 'none',
          conflict: { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse: false },
        }),
      ],
    });
    const html = renderHtml(mixed);
    const exec = html.slice(html.indexOf('id="exec-h"'), html.indexOf('id="findings-h"'));
    expect(exec).toContain('Among the packages whose license was identified, the most restrictive category present is permissive.');
  });

  it('states the category plainly when every package was identified', () => {
    const allKnown = baseData({
      packages: [
        makeResolved({ name: 'perm', license: 'MIT', category: 'permissive' }),
        makeResolved({ name: 'gpl', license: 'GPL-3.0-only', category: 'strong-copyleft',
          conflict: { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse: false } }),
      ],
    });
    const html = renderHtml(allKnown);
    const exec = html.slice(html.indexOf('id="exec-h"'), html.indexOf('id="findings-h"'));
    expect(exec).toContain('The most restrictive license category present is strong copyleft.');
    expect(exec).not.toContain('Among the packages whose license was identified');
  });
});

describe('renderHtml — print CSS', () => {
  it('includes print rules that keep finding cards intact and avoid a fixed page size', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('@media print');
    expect(html).toContain('page-break-inside: avoid');
    // A @page margin (not size) so both A4 and Letter print correctly.
    expect(html).toContain('@page { margin');
    expect(html).not.toMatch(/@page[^}]*size\s*:/i);
    // Print rule forces collapsed <details> open.
    expect(html).toContain('details:not([open])');
  });
});

describe('renderHtml — methodology appendix', () => {
  it('documents npm and PyPI resolution orders separately, confidence levels, and limitations', () => {
    const html = renderHtml(FULL_SPECTRUM);
    expect(html).toContain('npm packages');
    expect(html).toContain('PyPI packages');
    expect(html).toContain('License-Expression'); // PEP 639, PyPI-specific
    expect(html.toLowerCase()).toContain('confidence');
    expect(html).toContain('Limitations');
  });
});

describe('renderHtml — executive summary from real data', () => {
  it('templates the summary from the actual counts, not free text', () => {
    const html = renderHtml(FULL_SPECTRUM);
    const exec = html.slice(html.indexOf('id="exec-h"'), html.indexOf('id="findings-h"'));
    expect(exec).toContain('5 packages'); // total
    expect(exec).toContain('flagged as a license conflict');
    expect(exec).toContain('my-app');
  });

  it('states the strict-assumption sentence when the project license is unspecified', () => {
    const html = renderHtml(baseData({ projectLicense: { id: 'unspecified', wasUnspecified: true }, packages: [CLEAN_PKG] }));
    expect(html).toContain('proprietary-equivalent conflict rules');
  });
});

describe('renderHtml — real fixture through the full pipeline', () => {
  it('renders resolve-08-conflict-matrix end-to-end with real CONFLICT findings, offline', async () => {
    const data = await buildReportData(
      path.join(__dirname, '../../fixtures/resolve-08-conflict-matrix'),
      { productionOnly: false },
    );
    const html = renderHtml(data);

    // Structure holds on real data.
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    let last = -1;
    for (const marker of SECTION_MARKERS) {
      const at = html.indexOf(marker);
      expect(at, `marker ${marker}`).toBeGreaterThan(last);
      last = at;
    }

    // Both real conflicts render with their verbatim vendored explanations.
    expect(html).toContain('strong-copyleft-pkg&#64;1.0.0');
    expect(html).toContain('noncommercial-pkg&#64;1.0.0');
    expect(html).toContain(EXPLANATIONS['strong-copyleft-in-proprietary']);
    expect(html).toContain(EXPLANATIONS['noncommercial-conflict']);

    // The clean permissive package is absent from findings but present in inventory.
    const inv = html.slice(html.indexOf('id="inventory-h"'), html.indexOf('id="method-h"'));
    expect(inv).toContain('permissive-pkg');

    // Offline guarantee holds on real data too.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
  });
});
