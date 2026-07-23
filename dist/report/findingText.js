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
exports.explanationFor = explanationFor;
exports.formatChain = formatChain;
exports.agplAlternativeNote = agplAlternativeNote;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("../paths");
// ─────────────────────────────────────────────────────────────────────────────
// Shared finding-rendering text helpers, reused by EVERY renderer that describes
// a package finding (the terminal summary and the HTML report today; PDF renders
// the HTML, so it inherits these for free). Kept in exactly one place — like
// `severity.ts` for the ordering and `PERMISSIVE_IDS` for the id set — so the
// terminal and the lawyer-facing HTML artifact can never silently say different
// things about the same package. The whole point of the vendored, reviewed
// explanation strings (spec §4.4) is that they render identically everywhere;
// a second copy of any of this logic would defeat that.
// ─────────────────────────────────────────────────────────────────────────────
let explanationsCache;
/**
 * The vendored, reviewed plain-English explanation for a conflict reason code,
 * read verbatim from `data/conflict-explanations.json`. Never rewritten,
 * paraphrased, or "friendlied up" for a particular output format. Returns
 * `undefined` for a null key (a clean package carries `explanationKey: null`).
 */
function explanationFor(key) {
    if (!key)
        return undefined;
    if (!explanationsCache) {
        explanationsCache = JSON.parse(fs.readFileSync(path.join(paths_1.DATA_DIR, 'conflict-explanations.json'), 'utf8')).explanations;
    }
    return explanationsCache[key];
}
/**
 * The single canonical dependency-chain phrasing. Shows the primary chain and,
 * when the enumeration cap was hit, the "at least N other paths" floor.
 *
 * `pathCountAtLeast` is a floor established by the path-enumeration cap
 * (Milestone 1), never an exact count once the cap is hit — "at least N"
 * phrasing is mandatory so the number is never misread as a precise total.
 */
function formatChain(pkg) {
    const chain = (pkg.paths[0] ?? [pkg.name]).join(' → ');
    const extra = pkg.pathCountAtLeast - 1;
    if (extra <= 0)
        return `via ${chain}`;
    return `via ${chain} (+at least ${extra.toLocaleString()} other path${extra === 1 ? '' : 's'})`;
}
/**
 * The informational note shown for an `agpl-informational` finding — a package
 * whose AGPL branch is a NON-chosen alternative (the selected branch is clean),
 * so it is surfaced for awareness but is not a conflict.
 *
 * `pkg.license` is the raw declared expression (e.g. "MIT OR AGPL-3.0-only") and
 * still includes the AGPL branch — using it here would read as "usable under
 * MIT OR AGPL-3.0-only", contradicting the whole point of this note. Show only
 * the non-AGPL id(s) that make the chosen branch clean.
 */
function agplAlternativeNote(pkg) {
    const nonAgplIds = pkg.licenseIds.filter((id) => !id.toUpperCase().startsWith('AGPL-'));
    const usableUnder = nonAgplIds.length > 0 ? nonAgplIds.join(' or ') : pkg.license;
    return `AGPL appears as an alternative license; package usable under ${usableUnder}.`;
}
//# sourceMappingURL=findingText.js.map