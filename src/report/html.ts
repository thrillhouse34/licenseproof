import type { ReportData } from './reportData';
import type { ResolvedPackage, LicenseCategory } from '../resolve/types';
import { classifySeverity, SEVERITY_ORDER, type Severity } from './severity';
import { explanationFor, formatChain, agplAlternativeNote } from './findingText';
import { getDataManifest } from '../resolve/dataManifest';

// ─────────────────────────────────────────────────────────────────────────────
// LicenseProof HTML report — the paid centerpiece artifact (Milestone 5, Task 2).
//
// A single self-contained `.html` file assembled with template literals (no
// template engine, per spec §8). ALL CSS is inline in one <style> block; there
// are ZERO external references of any kind (no <link>, no <script src>, no
// remote fonts/images/analytics) so the file is fully readable offline, from a
// file:// URL, forever. `tests/report/html.test.ts` greps the rendered output to
// enforce that offline guarantee.
//
// Design is BINDING per the brief §3: white background, near-black slate text
// (never pure #000), ONE deep-blue accent (#1e3a8a) used only for structure
// (rules, headers, links), generous whitespace, no gradients, no marketing tone.
// Every severity indicator is a text label plus a plain CSS shape (a colored
// square) — never an emoji or icon-font glyph that could render as tofu offline.
//
// All prose either (a) is a vendored, reviewed string rendered verbatim (the
// per-finding explanations, via `explanationFor` / `agplAlternativeNote` from the
// shared `findingText` module the terminal renderer also uses), or (b) is
// templated from numbers/booleans already computed in `ReportData` (the
// executive summary, the verdict line) — nothing here is free-generated text and
// nothing re-runs any resolution/categorization step.
//
// PRINT: `page-break-inside: avoid` keeps a finding card from splitting across a
// page break. No fixed `@page { size }` is declared, so the SAME file prints
// correctly on both A4 and Letter; the content column is capped at ~170mm so it
// sits comfortably inside either page width with margins. The printed footer is
// STATIC (not per-page-numbered): true per-page "page N of M" numbering is not
// achievable in portable, all-browser print CSS — that is specifically the PDF
// renderer's job (Task 3) via Puppeteer's `footerTemplate`. Do not "fix" this by
// chasing an impossible cross-browser page-counter hack.
// ─────────────────────────────────────────────────────────────────────────────

// Standard HTML text-content escaping. The apostrophe is deliberately NOT
// escaped: it is only special inside single-quoted attribute values, and no
// dynamic value is ever placed in a single-quoted attribute in this template.
// Leaving it unescaped means the vendored, reviewed explanation strings (which
// contain apostrophes, e.g. "this package's license") render BYTE-FOR-BYTE
// verbatim — the whole point of the reviewed strings per spec §4.4. `"` is
// still escaped (harmless in text content, and defensive if a value ever lands
// in a double-quoted attribute).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Human-facing labels for the four non-clean severities that become "findings".
// `clean` is never a finding (clean packages appear only in the inventory table),
// so it has no card label here.
const SEVERITY_LABEL: Record<Exclude<Severity, 'clean'>, string> = {
  conflict: 'Conflict',
  'agpl-informational': 'AGPL — informational',
  review: 'Review',
  unknown: 'Unknown',
};

// The severity-ordered section headings for the Findings section, in the exact
// brief order: CONFLICT → AGPL-informational → REVIEW → UNKNOWN.
const FINDING_SEVERITIES: Exclude<Severity, 'clean'>[] = ['conflict', 'agpl-informational', 'review', 'unknown'];

// "Most restrictive category present" ranking for the executive summary. Higher
// number = more restrictive. Deliberately explicit (not alphabetical / not
// insertion order) so the summary reads the same regardless of scan order.
//
// `unknown` is deliberately ABSENT. It is not a restrictiveness level — it is the
// absence of information — so it can never be named as "the most restrictive
// license category present" (a lawyer reading "the most restrictive category is
// unknown" learns nothing and is actively misled). Unidentified packages are
// already counted plainly in the preceding paragraph. See `restrictivenessOf`.
const CATEGORY_RISK: Record<Exclude<LicenseCategory, 'unknown'>, number> = {
  noncommercial: 4,
  'strong-copyleft': 3,
  'weak-copyleft': 2,
  'public-domain': 1,
  permissive: 0,
};

// Ranks a category only if it expresses a genuine restrictiveness level;
// `unknown` returns undefined and is excluded from the ranking entirely.
function restrictivenessOf(category: LicenseCategory): number | undefined {
  return category === 'unknown' ? undefined : CATEGORY_RISK[category];
}

const CATEGORY_LABEL: Record<LicenseCategory, string> = {
  permissive: 'permissive',
  'weak-copyleft': 'weak copyleft',
  'strong-copyleft': 'strong copyleft',
  noncommercial: 'noncommercial / commercial-restricted',
  'public-domain': 'public domain',
  unknown: 'unknown',
};

const NOT_LEGAL_ADVICE =
  'This report is an informational license categorization produced by automated analysis of ' +
  'declared package metadata and license files. It is not legal advice and is not a substitute ' +
  'for review by qualified counsel.';

interface Buckets {
  conflict: ResolvedPackage[];
  'agpl-informational': ResolvedPackage[];
  review: ResolvedPackage[];
  unknown: ResolvedPackage[];
  clean: ResolvedPackage[];
}

function bucketBySeverity(packages: ResolvedPackage[]): Buckets {
  const buckets: Buckets = { conflict: [], 'agpl-informational': [], review: [], unknown: [], clean: [] };
  for (const p of packages) buckets[classifySeverity(p)].push(p);
  for (const key of SEVERITY_ORDER) buckets[key].sort((a, b) => a.name.localeCompare(b.name));
  return buckets;
}

// The full-inventory sort: severity rank first, then name — byte-for-byte the
// same ordering the JSON renderer uses (src/report/json.ts), keyed off the shared
// SEVERITY_ORDER + classifySeverity so the two can never diverge.
function inventorySorted(packages: ResolvedPackage[]): ResolvedPackage[] {
  const severityRank = new Map(SEVERITY_ORDER.map((s, i) => [s, i]));
  return [...packages].sort((a, b) => {
    const ra = severityRank.get(classifySeverity(a))!;
    const rb = severityRank.get(classifySeverity(b))!;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

function ecosystemsPhrase(ecosystems: string[]): string {
  const names = ecosystems.map((e) => (e === 'npm' ? 'npm' : e === 'pypi' ? 'PyPI' : e));
  if (names.length === 0) return 'the';
  if (names.length === 1) return `the ${names[0]}`;
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

// A single, calm, factual verdict sentence assembled purely from the counts.
function verdictLine(b: Buckets): string {
  const c = b.conflict.length;
  const r = b.review.length;
  const u = b.unknown.length;
  const flagged = r + u;
  if (c > 0) {
    return `${c} license ${plural(c, 'conflict')} require${c === 1 ? 's' : ''} attention before distribution.`;
  }
  if (flagged > 0) {
    return `No license conflicts. ${flagged} ${plural(flagged, 'item')} flagged for manual review.`;
  }
  return 'No license conflicts or review items were found.';
}

// The executive summary: 2–3 short paragraphs templated ENTIRELY from data
// already in ReportData (counts, worst category, AGPL flag). No hype, no
// reassurance-language that oversells safety — same calm tone as the terminal
// output.
function executiveSummary(data: ReportData, b: Buckets): string {
  const total = data.packages.length;
  const c = b.conflict.length;
  const r = b.review.length;
  const u = b.unknown.length;
  const agplInfo = b['agpl-informational'].length;
  const clean = b.clean.length;

  // Worst category among the packages whose license was actually IDENTIFIED.
  // Packages that resolved to `unknown` are excluded — an absence of information
  // is not a restrictiveness level (see CATEGORY_RISK). When nothing was
  // identified at all, there is no honest answer and the sentence is omitted.
  const identifiedRisks = data.packages
    .map((p) => restrictivenessOf(p.category))
    .filter((r): r is number => r !== undefined);
  const worstRisk = identifiedRisks.length > 0 ? Math.max(...identifiedRisks) : undefined;
  const worstCategory =
    worstRisk === undefined
      ? undefined
      : (Object.keys(CATEGORY_RISK) as Exclude<LicenseCategory, 'unknown'>[]).find(
          (k) => CATEGORY_RISK[k] === worstRisk,
        );
  const unidentified = data.packages.filter((p) => p.category === 'unknown').length;
  const anyAgplNetworked = data.packages.some((p) => p.conflict.agplNetworkedUse);

  const paras: string[] = [];

  // Paragraph 1 — scope of the scan.
  let p1 =
    `This report covers ${total} ${plural(total, 'package')} resolved from ${ecosystemsPhrase(data.ecosystems)} ` +
    `${plural(data.ecosystems.length, 'dependency tree')} of ${escapeHtml(data.projectName || 'the project')}, ` +
    `whose declared project license is ${escapeHtml(data.projectLicense.id)}.`;
  if (data.projectLicense.wasUnspecified) {
    p1 +=
      ' No license was declared or recognized for this project, so the strictest, ' +
      'proprietary-equivalent conflict rules were applied.';
  }
  paras.push(p1);

  // Paragraph 2 — the findings tally.
  let p2: string;
  if (c > 0) {
    p2 =
      `${c} ${plural(c, 'package')} ${c === 1 ? 'was' : 'were'} flagged as a license conflict against the ` +
      `project license.`;
    if (r > 0) p2 += ` ${r} ${plural(r, 'package')} ${r === 1 ? 'was' : 'were'} flagged for manual review.`;
    if (u > 0) p2 += ` ${u} could not be confidently identified.`;
    p2 += ` The remaining ${clean} raised no flags.`;
  } else if (r + u > 0) {
    p2 = 'No license conflicts were found against the project license.';
    if (r > 0) p2 += ` ${r} ${plural(r, 'package')} ${r === 1 ? 'was' : 'were'} flagged for manual review.`;
    if (u > 0) p2 += ` ${u} could not be confidently identified.`;
    p2 += ` The remaining ${clean} raised no flags.`;
  } else {
    p2 = `No license conflicts, review items, or unidentified licenses were found across all ${total} ${plural(total, 'package')}.`;
  }
  paras.push(p2);

  // Paragraph 3 — worst category + AGPL context, only when there is something to say.
  const p3parts: string[] = [];
  if (worstCategory) {
    // When some packages could not be identified, the claim is scoped to the
    // ones that were — otherwise it would overstate what the scan can support.
    p3parts.push(
      unidentified > 0
        ? `Among the packages whose license was identified, the most restrictive category present is ${CATEGORY_LABEL[worstCategory]}.`
        : `The most restrictive license category present is ${CATEGORY_LABEL[worstCategory]}.`,
    );
  }
  if (agplInfo > 0) {
    p3parts.push(
      `${agplInfo} ${plural(agplInfo, 'package')} list${agplInfo === 1 ? 's' : ''} AGPL as an alternative ` +
        `(non-selected) license branch; ${agplInfo === 1 ? 'it is' : 'they are'} noted for awareness but not ` +
        `treated as a conflict because a non-AGPL branch was selected.`,
    );
  } else if (anyAgplNetworked) {
    p3parts.push(
      "One or more packages are AGPL-licensed; AGPL's copyleft obligations extend to networked use, so they " +
        'are surfaced prominently in the findings below.',
    );
  }
  if (p3parts.length > 0) paras.push(p3parts.join(' '));

  return paras.map((p) => `        <p>${p}</p>`).join('\n');
}

// One finding card. `pkg.license` is rendered in full (OR / WITH clauses intact).
function findingCard(pkg: ResolvedPackage, severity: Exclude<Severity, 'clean'>): string {
  // Explanation: vendored string for a real conflict reason code, or the shared
  // AGPL-alternative note for the informational case (which carries a null key).
  const explanation =
    severity === 'agpl-informational' ? agplAlternativeNote(pkg) : explanationFor(pkg.conflict.explanationKey);

  const rows: string[] = [];
  rows.push(metaRow('License', `<span class="mono">${escapeHtml(pkg.license)}</span>`));
  rows.push(metaRow('Category', escapeHtml(CATEGORY_LABEL[pkg.category])));
  rows.push(metaRow('Confidence', escapeHtml(pkg.confidence)));
  rows.push(metaRow('Source', escapeHtml(pkg.source)));
  rows.push(metaRow('Dependency', escapeHtml(formatChain(pkg))));

  const scope = pkg.dev ? 'dev dependency' : 'production dependency';
  const directness = pkg.direct ? 'direct' : 'transitive';

  return `      <article class="finding" data-severity="${severity}">
        <div class="finding__head">
          <span class="chip chip--${severity}"><span class="chip__dot"></span>${escapeHtml(SEVERITY_LABEL[severity])}</span>
          <!-- &#64; not a literal @: hosting proxies with email-address obfuscation
               (e.g. Cloudflare Scrape Shield) pattern-match "name@version" as an
               email address and silently rewrite it into a mailto link. -->
          <span class="finding__name mono">${escapeHtml(pkg.name)}&#64;${escapeHtml(pkg.version)}</span>
          <span class="tag">${escapeHtml(pkg.ecosystem)}</span>
          <span class="tag tag--muted">${directness} · ${scope}</span>
        </div>
        <dl class="finding__meta">
${rows.join('\n')}
        </dl>
${explanation ? `        <p class="finding__explain">${escapeHtml(explanation)}</p>` : ''}
      </article>`;
}

function metaRow(label: string, valueHtml: string): string {
  return `          <div class="meta-row"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function findingsSection(b: Buckets): string {
  const anyFindings = FINDING_SEVERITIES.some((s) => b[s].length > 0);
  if (!anyFindings) {
    return `      <p class="empty">No conflicts, AGPL notes, review items, or unidentified licenses were found. Every scanned package resolved to a license that raised no flags against the project license. See the full inventory below.</p>`;
  }
  const sections: string[] = [];
  for (const severity of FINDING_SEVERITIES) {
    const pkgs = b[severity];
    if (pkgs.length === 0) continue;
    const cards = pkgs.map((p) => findingCard(p, severity)).join('\n');
    sections.push(`      <h3 class="finding-group">${escapeHtml(SEVERITY_LABEL[severity])} <span class="count">(${pkgs.length})</span></h3>
${cards}`);
  }
  return sections.join('\n');
}

function inventoryTable(packages: ResolvedPackage[]): string {
  const rows = inventorySorted(packages)
    .map((p) => {
      const sev = classifySeverity(p);
      return `            <tr>
              <td class="mono">${escapeHtml(p.name)}</td>
              <td class="mono">${escapeHtml(p.version)}</td>
              <td>${escapeHtml(p.ecosystem)}</td>
              <td class="mono">${escapeHtml(p.license)}</td>
              <td>${escapeHtml(CATEGORY_LABEL[p.category])}</td>
              <td>${escapeHtml(p.confidence)}</td>
              <td>${escapeHtml(p.source)}</td>
              <td><span class="chip chip--${sev} chip--sm"><span class="chip__dot"></span>${escapeHtml(sev === 'clean' ? 'clean' : SEVERITY_LABEL[sev])}</span></td>
            </tr>`;
    })
    .join('\n');
  // Explicit column widths. Required by `table-layout: fixed` (see the CSS note)
  // and tuned so (a) every uppercase header label fits on ONE line and (b) the
  // three nowrap fixed-vocabulary columns (Ecosystem/Confidence/Source) are wide
  // enough for their longest token at the narrowest rendering we support — the
  // ~605px content column of an A4 PDF page. Package and License get the extra
  // room since they hold the genuinely-long values (scoped names, full SPDX
  // OR/WITH expressions) that still wrap via break-word.
  // Order: Package Version Ecosystem License Category Confidence Source Status.
  // Ecosystem/Confidence keep enough width for their nowrap uppercase HEADERS
  // ("ECOSYSTEM"/"CONFIDENCE"); Status keeps enough for its widest chip; Source
  // is widened from the old 9% (which force-broke "metadata") to fit its longest
  // token on one line, funded by the over-allocated Version column.
  return `        <table class="inventory">
          <colgroup>
            <col style="width:14%"><col style="width:11%"><col style="width:12%"><col style="width:11%">
            <col style="width:13%"><col style="width:12%"><col style="width:12%"><col style="width:15%">
          </colgroup>
          <thead>
            <tr>
              <th>Package</th><th>Version</th><th>Ecosystem</th><th>License</th>
              <th>Category</th><th>Confidence</th><th>Source</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
${rows}
          </tbody>
        </table>`;
}

function warningsSection(warnings: string[]): string {
  if (warnings.length === 0) return '';
  const items = warnings.map((w) => `          <li>${escapeHtml(w)}</li>`).join('\n');
  return `    <section class="section" aria-labelledby="warnings-h">
      <h2 id="warnings-h">Scan warnings</h2>
      <ul class="warnings">
${items}
      </ul>
    </section>`;
}

// The methodology appendix describes the ACTUAL, code-accurate resolution order
// for each ecosystem (see src/resolve/licenseResolver.ts) — npm short-circuits
// on the first resolving step; PyPI computes its metadata signals together so a
// metadata-vs-classifier disagreement can be surfaced. Written to match what the
// code does, not a rounded "5 steps" ideal.
function methodologyAppendix(): string {
  return `        <h3>How each package's license is resolved</h3>
        <p>LicenseProof reads only files already present on disk from the scanned project and its installed dependencies. It never contacts a network, registry, or remote service. The two ecosystems use different resolution orders:</p>

        <h4>npm packages</h4>
        <p>The first step that yields a license wins (later steps are not consulted):</p>
        <ol>
          <li><strong>Declared metadata</strong> — the <code>license</code> field in the package's <code>package.json</code>, parsed as an SPDX id or expression (OR / AND / WITH preserved). Confidence: high. npm's <code>UNLICENSED</code> convention is not treated as an SPDX id and falls through.</li>
          <li><strong>License file</strong> — the text of an on-disk <code>LICENSE</code>/<code>COPYING</code> file, matched by fingerprint against known license texts. Confidence: medium for a close match, low for a modified or partial match.</li>
          <li><strong>README mention</strong> — a <code>License:</code> line near the top of the README. Confidence: low.</li>
          <li><strong>Unknown</strong> — no signal resolved; the package is reported as <code>UNKNOWN</code> and flagged for review. Unknown does not mean safe.</li>
        </ol>

        <h4>PyPI packages</h4>
        <p>The metadata signals are read together so a disagreement between them can be surfaced; the on-disk steps run only when no metadata signal resolved:</p>
        <ol>
          <li><strong>License-Expression</strong> — the PEP 639 <code>License-Expression</code> metadata field. Confidence: high.</li>
          <li><strong>License</strong> — the legacy <code>License</code> metadata field, used when no <code>License-Expression</code> is present. Confidence: high.</li>
          <li><strong>Trove classifiers</strong> — the <code>License ::</code> classifiers, mapped to a representative SPDX id. Confidence: medium (classifiers are coarser than an explicit id — e.g. "BSD License" cannot distinguish BSD-2 from BSD-3).</li>
          <li><strong>License file</strong> — on-disk license text, fingerprint-matched. Confidence: medium / low, as for npm.</li>
          <li><strong>README mention</strong> — a <code>License:</code> line. Confidence: low.</li>
          <li><strong>Unknown</strong> — reported as <code>UNKNOWN</code>, flagged for review.</li>
        </ol>
        <p>When a PyPI package's declared license field and its Trove classifiers resolve to different licenses (and not merely to different variants of the same license family), the package is additionally flagged for review as an internal metadata inconsistency.</p>

        <h3>What the confidence levels mean</h3>
        <ul>
          <li><strong>high</strong> — the license came from an explicit, declared SPDX id or expression in package or project metadata.</li>
          <li><strong>medium</strong> — the license was inferred from a close license-file text match or from a coarse Trove classifier.</li>
          <li><strong>low</strong> — the license came from a modified/partial license-file match, a README mention, or could not be determined at all (Unknown).</li>
        </ul>

        <h3>Limitations</h3>
        <ul>
          <li>The category assigned to each license is an informational classification, not a legal determination of your obligations.</li>
          <li>Only declared and detectable license signals are used. No manual legal review is performed, and no upstream registry is consulted (the tool runs fully offline).</li>
          <li>Dependency paths are enumerated up to a cap; a "+at least N other paths" note is a floor, not an exact total.</li>
          <li>A package's resolved license reflects the metadata and files present on disk at scan time; it is not verified against any external source of truth.</li>
          <li>Unknown does not mean safe — it means the license could not be identified confidently and needs a human to look.</li>
        </ul>

        <h3>Not legal advice</h3>
        <p>${escapeHtml(NOT_LEGAL_ADVICE)}</p>`;
}

export function renderHtml(data: ReportData): string {
  const b = bucketBySeverity(data.packages);
  const manifest = getDataManifest();
  const total = data.packages.length;

  // Package counts by ecosystem, in a fixed reading order (npm before pypi),
  // derived from each package's own ecosystem tag (robust to the merge).
  const ecoCounts = new Map<string, number>();
  for (const p of data.packages) ecoCounts.set(p.ecosystem, (ecoCounts.get(p.ecosystem) ?? 0) + 1);
  const ECO_ORDER = ['npm', 'pypi'];
  const ecoList = [...ecoCounts.keys()].sort(
    (a, z) => (ECO_ORDER.indexOf(a) + 1 || 99) - (ECO_ORDER.indexOf(z) + 1 || 99),
  );
  const ecoCountsText =
    ecoList.length > 0 ? ecoList.map((e) => `${escapeHtml(e)}: ${ecoCounts.get(e)}`).join(' · ') : 'none';

  const provenance =
    `LicenseProof ${escapeHtml(data.toolVersion)} · ` +
    `reference data ${escapeHtml(data.dataVersion)} ` +
    `(SPDX license list ${escapeHtml(manifest.spdxListVersion)}) · ` +
    `scanned ${escapeHtml(data.scanTimestamp)}`;

  const title = `LicenseProof report — ${escapeHtml(data.projectName || 'project')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root {
  --ink: #1a1a2e;          /* near-black slate, never pure #000 */
  --muted: #5b6472;        /* secondary text */
  --accent: #1e3a8a;       /* the ONE accent — structure only */
  --rule: #d7dbe3;         /* hairline borders */
  --rule-soft: #eceef2;
  --paper: #ffffff;
  --panel: #f7f8fa;        /* faint neutral panel, not a colored wash */
  --sev-conflict: #b91c1c;
  --sev-review: #b45309;
  --sev-agpl: #1e3a8a;     /* accent-adjacent by design — non-blocking */
  --sev-unknown: #6b7280;
  --sev-clean: #4b7a53;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
}
.mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.92em; }
.page { max-width: 900px; margin: 0 auto; padding: 56px 40px 72px; }
a { color: var(--accent); }

/* ---- Cover header ---- */
.cover { border-bottom: 3px solid var(--accent); padding-bottom: 28px; margin-bottom: 40px; }
.cover__kicker { font-size: 0.8rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin: 0 0 10px; }
.cover h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 6px; font-weight: 700; }
.cover h1 .project { color: var(--accent); }
.cover__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 4px 28px; margin: 22px 0 20px; }
/* Every cover label is short enough to sit on one line in a ~195px A4 grid
   column — the old combined conflict/review/unknown label was the one
   exception and is now three separate one-word facts. Flex column +
   space-between additionally pins each value to the BOTTOM of its cell, so if a
   label ever does wrap (a narrow viewport, a longer project field), the values
   across a row still align instead of one dropping a line below its neighbours. */
.cover__facts .fact { display: flex; flex-direction: column; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--rule-soft); }
.cover__facts dt { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin: 0; }
.cover__facts dd { margin: 2px 0 0; font-weight: 600; }
/* The ISO scan timestamp is one indivisible token, but a browser will happily
   break it after a hyphen (2026-07- / 22T05:10:39.276Z). Hold it on one line and
   size it to fit the narrowest A4 grid column. */
.cover__facts dd.ts { white-space: nowrap; font-size: 0.88rem; }
.verdict { font-size: 1.06rem; font-weight: 600; margin: 18px 0 0; padding: 12px 16px; border-left: 4px solid var(--accent); background: var(--panel); }
.scope-note { font-size: 0.85rem; color: var(--muted); margin: 16px 0 0; }

/* ---- Sections ---- */
.section { margin: 48px 0; }
.section > h2 { font-size: 1.35rem; margin: 0 0 4px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); font-weight: 700; }
.section__lead { color: var(--muted); margin: 8px 0 20px; }
h3 { font-size: 1.08rem; margin: 30px 0 12px; }
h4 { font-size: 0.98rem; margin: 22px 0 8px; color: var(--accent); }
p { margin: 0 0 14px; }
.empty { color: var(--muted); font-style: italic; padding: 16px; background: var(--panel); border-radius: 6px; }

/* ---- Executive summary ---- */
.exec p { max-width: 68ch; }

/* ---- Severity chips (text label + plain CSS square, never an emoji) ---- */
.chip { display: inline-flex; align-items: center; gap: 7px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 10px 3px 8px; border: 1px solid var(--rule); border-radius: 4px; white-space: nowrap; }
.chip__dot { width: 10px; height: 10px; border-radius: 2px; background: var(--sev-unknown); flex: none; }
/* The inventory-table chip only. Kept deliberately compact (small type, tight
   padding, minimal letter-spacing, a smaller gap) so the fixed Status column can
   be narrow enough to leave the Package/Version columns room to hold their
   values without force-breaking a name mid-word. It is still a real CSS square
   plus an uppercase text label, per the brief. */
.chip--sm { font-size: 0.62rem; letter-spacing: 0.01em; gap: 4px; padding: 2px 5px; white-space: nowrap; }
.chip--sm .chip__dot { width: 7px; height: 7px; }
.chip--conflict { color: var(--sev-conflict); border-color: var(--sev-conflict); }
.chip--conflict .chip__dot { background: var(--sev-conflict); }
.chip--review { color: var(--sev-review); border-color: var(--sev-review); }
.chip--review .chip__dot { background: var(--sev-review); }
.chip--agpl-informational { color: var(--sev-agpl); border-color: var(--sev-agpl); }
.chip--agpl-informational .chip__dot { background: var(--sev-agpl); }
.chip--unknown { color: var(--sev-unknown); border-color: var(--sev-unknown); }
.chip--unknown .chip__dot { background: var(--sev-unknown); }
.chip--clean { color: var(--sev-clean); border-color: var(--rule); }
.chip--clean .chip__dot { background: var(--sev-clean); }

.tag { display: inline-block; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border: 1px solid var(--rule); border-radius: 4px; color: var(--muted); }
.tag--muted { border-color: var(--rule-soft); }

/* ---- Findings ---- */
.finding-group { display: flex; align-items: baseline; gap: 8px; margin-top: 34px; }
.finding-group .count { color: var(--muted); font-weight: 400; font-size: 0.95rem; }
.finding { border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; margin: 14px 0; page-break-inside: avoid; break-inside: avoid; }
.finding[data-severity="conflict"] { border-left: 4px solid var(--sev-conflict); }
.finding[data-severity="agpl-informational"] { border-left: 4px solid var(--sev-agpl); }
.finding[data-severity="review"] { border-left: 4px solid var(--sev-review); }
.finding[data-severity="unknown"] { border-left: 4px solid var(--sev-unknown); }
.finding__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.finding__name { font-size: 1.02rem; font-weight: 700; }
.finding__meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 2px 24px; margin: 0 0 12px; }
.meta-row { display: flex; gap: 10px; padding: 5px 0; border-top: 1px solid var(--rule-soft); min-width: 0; }
.meta-row dt { flex: none; width: 92px; color: var(--muted); font-size: 0.85rem; }
/* break-word, not "anywhere" — see the inventory-table note below. "anywhere"
   split ordinary values mid-word (metadata -> meta/data, 5.3.0 -> 5.3./0). */
.meta-row dd { margin: 0; min-width: 0; overflow-wrap: break-word; }
.finding__explain { margin: 4px 0 0; max-width: 74ch; }

/* ---- Inventory table ---- */
details.inventory-details { border: 1px solid var(--rule); border-radius: 8px; padding: 4px 18px; margin-top: 8px; }
details.inventory-details > summary { cursor: pointer; font-weight: 600; padding: 12px 4px; list-style-position: inside; }
details.methodology { border: 1px solid var(--rule); border-radius: 8px; padding: 4px 20px; margin-top: 8px; }
details.methodology > summary { cursor: pointer; font-weight: 600; padding: 12px 4px; list-style-position: inside; }
.table-scroll { overflow-x: auto; }
/* table-layout: fixed + the colgroup percentages are load-bearing, not
   cosmetic. Under AUTO layout an 8-column table sizes itself from each column's
   intrinsic min-content width, and break-word is (per spec)
   NOT considered when computing min-content — so one long package name forced
   the whole table wider than the printed page and silently clipped the Status
   column off the right edge of the PDF. Under FIXED layout the widths below are
   authoritative, the table is always exactly as wide as its container, and
   break-word then breaks only the rare value that genuinely cannot fit. */
table.inventory { table-layout: fixed; border-collapse: collapse; width: 100%; font-size: 0.72rem; margin: 8px 0 16px; }
table.inventory th, table.inventory td { text-align: left; padding: 7px 5px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
/* Headers are short fixed labels (Package, Version, …) and must NEVER wrap:
   overflow-wrap "anywhere" used to break them mid-word as PACKAG/E, VERS/ION.
   Their type is sized so every label fits its column on one line even in the
   narrow A4 print column. */
table.inventory th { white-space: nowrap; }
/* break-word, never "anywhere": "anywhere" breaks inside a word even when the
   word would fit on its own line, which split version numbers (5.3./0) and SPDX
   ids (GPL-3.0-/or-later) mid-token. break-word only breaks a word that
   genuinely cannot fit in its column at all. */
table.inventory td { overflow-wrap: break-word; }
/* Fixed-vocabulary columns hold a CLOSED set of short single-word tokens —
   Ecosystem (npm/pypi), Confidence (high/medium/low), Source
   (metadata/expression/classifier/license-file/readme/none). Their colgroup
   widths above are sized to fit the longest token, so these values must never
   wrap: break-word alone still split them mid-character in the printed PDF at
   the narrow A4 column (metadata -> metada/ta, classifier -> classif/ier),
   which reads as unfinished. nth-child indexes match the colgroup order
   (3=Ecosystem, 6=Confidence, 7=Source). Category (col 5) is DELIBERATELY
   excluded — its rendered labels are multi-word ("strong copyleft",
   "noncommercial / commercial-restricted") and wrap cleanly at spaces, so
   nowrap there would overflow the cell. Status (col 8) is a chip that already
   carries its own white-space: nowrap. Package/Version/License stay break-word:
   real scoped names and full SPDX OR/WITH expressions can genuinely be too long
   for their column and must be allowed to wrap. */
table.inventory td:nth-child(3),
table.inventory td:nth-child(6),
table.inventory td:nth-child(7) { white-space: nowrap; }
table.inventory thead th { border-bottom: 2px solid var(--rule); color: var(--muted); font-size: 0.6rem; letter-spacing: 0.02em; text-transform: uppercase; }
table.inventory tbody tr:last-child td { border-bottom: none; }

/* ---- Warnings ---- */
.warnings { margin: 0; padding-left: 20px; color: var(--muted); }
.warnings li { margin: 6px 0; }

/* ---- Provenance footer ---- */
.provenance { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.82rem; }
.provenance .mono { color: var(--ink); }

ol, ul { max-width: 74ch; }
li { margin: 5px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: var(--panel); padding: 1px 5px; border-radius: 3px; }

/* ---- Print ---- */
@media print {
  /* No @page { size } — the same file must print correctly on A4 AND Letter.
     A ~170mm content column fits inside both page widths with margins. */
  @page { margin: 16mm; }
  body { font-size: 11pt; }
  .page { max-width: 170mm; padding: 0; margin: 0; }
  a { color: var(--ink); text-decoration: none; }
  .verdict, .empty, code { background: transparent !important; }
  .verdict { border-left-color: var(--ink); }
  /* Force every collapsible open when printing, even if a screen viewer
     collapsed it — reveal the non-summary children a closed details hides. */
  details:not([open]) > *:not(summary) { display: revert !important; }
  details > summary { list-style: none; }
  details.inventory-details, details.methodology { border-color: var(--rule); }
  .finding, table.inventory tr, .cover { page-break-inside: avoid; break-inside: avoid; }
  .section { page-break-inside: auto; }
  h2, h3, h4 { page-break-after: avoid; }
}
</style>
</head>
<body>
  <main class="page">

    <!-- (1) Cover header -->
    <header class="cover">
      <p class="cover__kicker">LicenseProof · Dependency license report</p>
      <h1>License report for <span class="project">${escapeHtml(data.projectName || 'project')}</span></h1>
      <dl class="cover__facts">
        <div class="fact"><dt>Project license</dt><dd class="mono">${escapeHtml(data.projectLicense.id)}${data.projectLicense.wasUnspecified ? ' (unspecified)' : ''}</dd></div>
        <div class="fact"><dt>Scan date</dt><dd class="ts">${escapeHtml(data.scanTimestamp)}</dd></div>
        <div class="fact"><dt>Packages</dt><dd>${total} (${ecoCountsText})</dd></div>
        <div class="fact"><dt>Conflicts</dt><dd>${b.conflict.length}</dd></div>
        <div class="fact"><dt>Review</dt><dd>${b.review.length}</dd></div>
        <div class="fact"><dt>Unknown</dt><dd>${b.unknown.length}</dd></div>
        <div class="fact"><dt>Tool version</dt><dd class="mono">${escapeHtml(data.toolVersion)}</dd></div>
        <div class="fact"><dt>Data version</dt><dd class="mono">${escapeHtml(data.dataVersion)}</dd></div>
      </dl>
      <p class="verdict">${escapeHtml(verdictLine(b))}</p>
      <p class="scope-note">Informational license categorization — not legal advice.</p>
    </header>

    <!-- (2) Executive summary -->
    <section class="section exec" aria-labelledby="exec-h">
      <h2 id="exec-h">Executive summary</h2>
${executiveSummary(data, b)}
    </section>

    <!-- (3) Findings, severity-ordered: conflict → AGPL-informational → review → unknown -->
    <section class="section" aria-labelledby="findings-h">
      <h2 id="findings-h">Findings</h2>
      <p class="section__lead">Packages that raised a flag against the project license, most restrictive first. Clean packages are listed in the full inventory below.</p>
${findingsSection(b)}
    </section>

${warningsSection(data.warnings)}

    <!-- (4) Full inventory -->
    <section class="section" aria-labelledby="inventory-h">
      <h2 id="inventory-h">Full inventory</h2>
      <p class="section__lead">Every scanned package, ordered by status then name. Matches the JSON report ordering.</p>
      <details class="inventory-details" open>
        <summary>All ${total} ${plural(total, 'package')}</summary>
        <div class="table-scroll">
${inventoryTable(data.packages)}
        </div>
      </details>
    </section>

    <!-- (5) Methodology appendix -->
    <section class="section" aria-labelledby="method-h">
      <h2 id="method-h">Methodology &amp; limitations</h2>
      <details class="methodology" open>
        <summary>How licenses were resolved, what confidence means, and known limitations</summary>
${methodologyAppendix()}
      </details>
    </section>

    <!-- (6) Provenance footer (static — per-page numbering is the PDF's job) -->
    <footer class="provenance">
      <p class="mono">${provenance}</p>
      <p>${escapeHtml(NOT_LEGAL_ADVICE)}</p>
    </footer>

  </main>
</body>
</html>
`;
}
