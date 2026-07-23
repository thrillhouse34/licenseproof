"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLicenseForPackage = resolveLicenseForPackage;
const spdxParser_1 = require("./spdxParser");
const spdxData_1 = require("./spdxData");
const fingerprint_1 = require("./fingerprint");
const categories_1 = require("../rules/categories");
const conflicts_1 = require("../rules/conflicts");
const permissiveIds_1 = require("./permissiveIds");
const classifierMap_1 = require("./classifierMap");
function normalizeIdList(ids) {
    let deprecatedFrom;
    const normalized = ids.map((id) => {
        const { normalized: n, wasDeprecated } = (0, spdxData_1.normalizeSpdxId)(id);
        if (wasDeprecated)
            deprecatedFrom = id;
        return n;
    });
    return { normalized, deprecatedFrom };
}
function resolveFromDeclared(declared) {
    // npm's own "no public license" convention, not an SPDX id — never treat
    // it as one, always fall through to fingerprint/readme/none.
    if (declared.trim().toUpperCase() === 'UNLICENSED')
        return null;
    const parsed = (0, spdxParser_1.parseSpdxExpression)(declared);
    if (!parsed.ok)
        return null; // malformed — e.g. "SEE LICENSE IN X" — fall through, never throw
    const rawIds = (0, spdxParser_1.flattenLicenseIds)(parsed.expr);
    const { normalized: allIds, deprecatedFrom } = normalizeIdList(rawIds);
    const isExpression = parsed.expr.type !== 'license'; // OR/AND/WITH all count — a WITH clause must never collapse to the bare base id
    const chosenIds = (0, spdxParser_1.mostPermissiveBranch)(parsed.expr, permissiveIds_1.PERMISSIVE_IDS);
    const { normalized: chosenNormalized } = normalizeIdList(chosenIds);
    const category = (0, categories_1.categorizeIds)(chosenNormalized); // riskiest-wins WITHIN the chosen branch only — never the whole expression
    return {
        license: isExpression ? declared : allIds[0],
        licenseIds: allIds,
        category,
        confidence: 'high',
        source: isExpression ? 'expression' : 'metadata',
        normalizedFrom: deprecatedFrom,
    };
}
function resolveFromFingerprint(text) {
    const match = (0, fingerprint_1.fingerprintLicenseText)(text);
    if (!match)
        return null;
    return {
        license: match.similarity >= 0.9 ? match.licenseId : `${match.licenseId}-like (modified)`,
        licenseIds: [match.licenseId],
        category: (0, categories_1.categorizeLicenseId)(match.licenseId),
        confidence: match.similarity >= 0.9 ? 'medium' : 'low',
        source: 'license-file',
    };
}
function resolveFromReadme(readmeText) {
    const lines = readmeText.split('\n').slice(0, 50);
    for (const line of lines) {
        const match = line.match(/license\s*[:\-]\s*([A-Za-z0-9.\-+]+)/i);
        if (match) {
            const { normalized } = (0, spdxData_1.normalizeSpdxId)(match[1]);
            return { license: normalized, licenseIds: [normalized], category: (0, categories_1.categorizeLicenseId)(normalized), confidence: 'low', source: 'readme' };
        }
    }
    return null;
}
const NONE_RESULT = { license: 'UNKNOWN', licenseIds: [], category: 'unknown', confidence: 'low', source: 'none' };
// Reuse resolveFromDeclared's SPDX parse/flatten/most-permissive-branch/
// categorize logic verbatim for a PyPI metadata field, but stamp the source
// according to WHICH field the value came from (`License-Expression` ->
// 'expression', `License` -> 'metadata') rather than resolveFromDeclared's
// own shape-based source. For PyPI, 'expression' vs 'metadata' means "which
// metadata field answered", a cleaner and more predictable signal for the
// two-field disagreement logic than the npm shape heuristic.
function resolveFromMetadataField(value, source) {
    // "UNKNOWN" is setuptools' historic placeholder for an unspecified License
    // field (analogous to npm's "UNLICENSED" convention) — it is NOT a real SPDX
    // id, even though the bare-token SPDX parser would happily accept it as one.
    // Guard it here, PyPI-side only, so it falls through to the classifier /
    // fingerprint steps rather than resolving to a bogus "UNKNOWN" license.
    if (value.trim().toUpperCase() === 'UNKNOWN')
        return null;
    const r = resolveFromDeclared(value);
    if (!r)
        return null;
    return { ...r, source };
}
// Step 3 for PyPI: map `License ::`-prefixed Trove classifiers through the
// vendored table (Task 2). First mapped match wins — classifiers are rarely
// genuinely contradictory among themselves; a real cross-signal disagreement is
// handled separately below against the License/License-Expression fields. The
// raw classifier list is filtered HERE (at consumption), not at parse time.
function resolveFromClassifiers(classifiers) {
    for (const c of classifiers) {
        if (!c.startsWith('License ::'))
            continue;
        const mapped = (0, classifierMap_1.mapClassifierToSpdxId)(c);
        if (!mapped)
            continue;
        const { normalized } = (0, spdxData_1.normalizeSpdxId)(mapped);
        return {
            license: normalized,
            licenseIds: [normalized],
            category: (0, categories_1.categorizeLicenseId)(normalized),
            // Author-declared structured metadata, but coarser than an SPDX id/
            // expression (e.g. "BSD License" can't distinguish BSD-2 from BSD-3), so
            // medium, not high.
            confidence: 'medium',
            source: 'classifier',
        };
    }
    return null;
}
function buildResolved(pkg, step, conflict) {
    return { ...pkg, license: step.license, licenseIds: step.licenseIds, category: step.category, confidence: step.confidence, source: step.source, normalizedFrom: step.normalizedFrom, conflict };
}
// PyPI resolution pipeline. Unlike the npm path (which short-circuits on the
// first hit), steps 1-3 (License-Expression, License, classifiers) are all
// computed up front so a metadata-vs-classifier disagreement can be detected
// and surfaced as a REVIEW note. Steps 4-6 (license-file fingerprint, README,
// UNKNOWN) only run when no metadata signal resolved at all.
function resolvePyPiPackage(pkg, licenseFileText, readmeText, mode, metadata) {
    // Step 1: License-Expression (PEP 639). Step 2: legacy License field, tried
    // only when the expression field is absent OR doesn't parse cleanly (free
    // text like "Apache 2.0"). "whichever fires first" => expression preferred.
    const expressionResult = metadata?.licenseExpression
        ? resolveFromMetadataField(metadata.licenseExpression, 'expression')
        : null;
    const metadataResult = !expressionResult && metadata?.license
        ? resolveFromMetadataField(metadata.license, 'metadata')
        : null;
    const licenseFieldResult = expressionResult ?? metadataResult;
    // Step 3: Trove classifiers, computed regardless of the above so the two
    // signals can be compared.
    const classifierResult = metadata ? resolveFromClassifiers(metadata.classifiers) : null;
    // Primary signal: prefer the more specific/parseable one
    // (License-Expression > License > classifier).
    let primary = licenseFieldResult ?? classifierResult;
    // Disagreement detection: only possible when BOTH the license-field result
    // and the classifier result resolved. They AGREE when the classifier's single
    // id is among the license-field's ids (covers the plain single-id case and
    // the "classifier id is one branch of an OR expression" case).
    //
    // They ALSO agree when the classifier id and a license-field id are different
    // variants of the SAME license family (BSD, GPL, LGPL, Apache, Artistic, AFL —
    // see sameLicenseFamily / LICENSE_FAMILIES in ../rules/categories). This is the
    // documented-ambiguity case: data/classifier-to-spdx.json deliberately maps a
    // generic classifier onto ONE representative variant ("License :: OSI Approved ::
    // BSD License" -> BSD-3-Clause) and its own `note` declares that safe because the
    // real candidates (BSD-2-Clause here) share a category. So a package with
    // `License-Expression: BSD-2-Clause` + a generic BSD classifier is NOT a
    // disagreement — both signals agree it is BSD/permissive, they only differ on which
    // BSD variant. Flagging it (as the old exact-id-only check did) directly contradicted
    // that documented safety claim and mis-flagged an extremely common real-world case.
    //
    // Family, not broad category, is the right granularity here: MIT and Apache-2.0 are
    // both `permissive` yet are genuinely different licenses (different families), so an
    // MIT-field-vs-Apache-classifier mismatch is a REAL, meaningful disagreement and must
    // still flag. A pure same-category rule would wrongly suppress it; same-family only
    // suppresses true same-lineage variant ambiguity, exactly matching Task 2's own list.
    let disagreement = false;
    if (licenseFieldResult && classifierResult) {
        const classifierId = classifierResult.licenseIds[0];
        const agrees = licenseFieldResult.licenseIds.includes(classifierId) ||
            licenseFieldResult.licenseIds.some((id) => (0, categories_1.sameLicenseFamily)(id, classifierId));
        disagreement = !agrees;
    }
    // Steps 4-6 (license-file fingerprint, README, UNKNOWN) — only when no
    // metadata signal fired. Reused as-is; note resolveFromFingerprint only ever
    // receives on-disk LICENSE FILE text, never a metadata string.
    if (!primary && licenseFileText)
        primary = resolveFromFingerprint(licenseFileText);
    if (!primary && readmeText)
        primary = resolveFromReadme(readmeText);
    if (!primary)
        primary = NONE_RESULT;
    let conflict = (0, conflicts_1.checkConflicts)(primary.category, primary.licenseIds, mode);
    // Disagreement post-processing (PyPI-specific; deliberately NOT baked into the
    // ecosystem-agnostic checkConflicts). Bump to at least REVIEW, never downgrade
    // an existing CONFLICT, and only claim the disagreement explanationKey when we
    // are the reason the level rose (level was NONE). If the level is already
    // REVIEW/CONFLICT for a substantive license-category reason, that explanation
    // is at least as important and is preserved (ConflictResult carries a single
    // explanationKey).
    if (disagreement && conflict.level === 'NONE') {
        conflict = { ...conflict, level: 'REVIEW', explanationKey: 'pypi-metadata-classifier-disagreement' };
    }
    return buildResolved(pkg, primary, conflict);
}
function resolveLicenseForPackage(pkg, licenseFileText, readmeText, projectLicenseId, pypiMetadata) {
    const mode = (0, conflicts_1.deriveProjectLicenseMode)(projectLicenseId);
    if (pkg.ecosystem === 'pypi') {
        return resolvePyPiPackage(pkg, licenseFileText, readmeText, mode, pypiMetadata);
    }
    // npm path (unchanged): short-circuit on the first resolving step.
    let step = null;
    if (pkg.licenseRaw)
        step = resolveFromDeclared(pkg.licenseRaw);
    if (!step && licenseFileText)
        step = resolveFromFingerprint(licenseFileText);
    if (!step && readmeText)
        step = resolveFromReadme(readmeText);
    if (!step)
        step = NONE_RESULT;
    const conflict = (0, conflicts_1.checkConflicts)(step.category, step.licenseIds, mode);
    return buildResolved(pkg, step, conflict);
}
//# sourceMappingURL=licenseResolver.js.map