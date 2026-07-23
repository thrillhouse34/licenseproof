"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeLicenseId = categorizeLicenseId;
exports.categorizeIds = categorizeIds;
exports.categorizeExpression = categorizeExpression;
exports.sameLicenseFamily = sameLicenseFamily;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("../paths");
const spdxParser_1 = require("../resolve/spdxParser");
let cached;
function load() {
    if (!cached)
        cached = JSON.parse(fs.readFileSync(path.join(paths_1.DATA_DIR, 'license-categories.json'), 'utf8'));
    return cached;
}
function categorizeLicenseId(id) {
    return load().categories[id] ?? 'unknown';
}
// Riskiest-first: a set of ids mixing categories must surface the most
// restrictive one present, since conflict logic needs the riskiest license
// actually in play, not the most permissive.
const RISK_ORDER = ['strong-copyleft', 'noncommercial', 'weak-copyleft', 'unknown', 'permissive', 'public-domain'];
function categorizeIds(ids) {
    const categories = ids.map(categorizeLicenseId);
    for (const risk of RISK_ORDER)
        if (categories.includes(risk))
            return risk;
    return 'unknown';
}
function categorizeExpression(expr) {
    return categorizeIds((0, spdxParser_1.flattenLicenseIds)(expr));
}
// License "families": groups of SPDX ids that are versioned/variant members of the
// SAME underlying license lineage. These are deliberately the exact set of families
// where PyPI's generic Trove classifiers (data/classifier-to-spdx.json) collapse a
// genuinely-ambiguous classifier onto ONE representative variant — e.g.
// "License :: OSI Approved :: BSD License" -> BSD-3-Clause even though BSD-2-Clause is
// equally plausible; "GNU General Public License (GPL)" -> GPL-3.0-only; "GNU Library or
// Lesser General Public License (LGPL)" -> LGPL-2.1-only; "Apache Software License",
// "Artistic License", and "Academic Free License (AFL)" likewise. That data file's own
// `note` documents these representative mappings as safe because the candidates share a
// category. The PyPI resolver uses this to avoid flagging a metadata-vs-classifier
// "disagreement" that is really just same-family variant ambiguity.
//
// GPL / LGPL / AGPL are kept as SEPARATE families on purpose: they are related but
// genuinely distinct licenses in different categories (strong-copyleft / weak-copyleft /
// strong-copyleft), so a GPL-vs-LGPL or GPL-vs-AGPL cross-signal mismatch is a REAL
// disagreement that must still surface. AGPL is intentionally absent here (its classifiers
// map to specific AGPL ids, never a generic representative), so it never suppresses.
const LICENSE_FAMILIES = [
    ['0BSD', 'BSD-1-Clause', 'BSD-2-Clause', 'BSD-2-Clause-Patent', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause'],
    ['Apache-1.0', 'Apache-1.1', 'Apache-2.0'],
    ['Artistic-1.0', 'Artistic-1.0-Perl', 'Artistic-1.0-cl8', 'Artistic-2.0'],
    ['GPL-1.0-only', 'GPL-1.0-or-later', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later'],
    ['LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later'],
    ['AFL-1.1', 'AFL-1.2', 'AFL-2.0', 'AFL-2.1', 'AFL-3.0'],
];
const ID_TO_FAMILY = (() => {
    const m = new Map();
    LICENSE_FAMILIES.forEach((family, i) => family.forEach((id) => m.set(id, i)));
    return m;
})();
// True iff both ids belong to the SAME known license family (see LICENSE_FAMILIES).
// Ids not in any family (MIT, ISC, MPL-2.0, AGPL-3.0-only, ...) never share a family —
// not even with themselves — so this only ever suppresses genuine same-lineage variant
// ambiguity, never a cross-license match. Callers should handle exact-id equality
// separately; this answers the narrower "same family, different variant" question.
function sameLicenseFamily(a, b) {
    const fa = ID_TO_FAMILY.get(a);
    return fa !== undefined && fa === ID_TO_FAMILY.get(b);
}
//# sourceMappingURL=categories.js.map