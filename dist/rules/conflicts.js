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
exports.deriveProjectLicenseModeFromIds = deriveProjectLicenseModeFromIds;
exports.deriveProjectLicenseMode = deriveProjectLicenseMode;
exports.checkConflicts = checkConflicts;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("../paths");
const permissiveIds_1 = require("../resolve/permissiveIds");
const spdxParser_1 = require("../resolve/spdxParser");
const GPL_FAMILY_IDS = new Set(['GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later']);
// The reduction logic shared by both the single-id and expression-aware
// entry points below. GPL-family is checked first (via `.some`) so it wins
// over permissive even when mixed with a permissive id in an AND expression
// (e.g. "MIT AND GPL-3.0-only" — conservative: both apply, so GPL-family
// rules govern). Permissive requires EVERY id in the set to be permissive
// (`.every`) — a single non-permissive id in the set falls through to the
// conservative proprietary default, same as the original single-id logic
// when given exactly one id.
function deriveProjectLicenseModeFromIds(ids) {
    if (ids.length === 0)
        return 'proprietary';
    if (ids.some((id) => id === 'proprietary'))
        return 'proprietary';
    if (ids.some((id) => GPL_FAMILY_IDS.has(id)))
        return 'gpl-family';
    if (ids.every((id) => permissiveIds_1.PERMISSIVE_IDS.has(id)))
        return 'permissive';
    return 'proprietary'; // conservative default for anything else, per spec's "simple, conservative" instruction
}
// Thin wrapper preserving the original single-string call signature (used by
// licenseResolver.ts et al.) but no longer assuming the string is a single
// SPDX id. `resolveProjectLicenseContext` already validates parseability
// before a value ever reaches here (unparseable input is normalized to the
// literal string "proprietary" via the UNSPECIFIED fallback), but this
// function is also unit-tested and called directly, so it re-parses
// defensively rather than trusting the caller.
//
// The bug this closes: an OR/AND/WITH expression like "MIT OR GPL-3.0-only"
// used to flow through here as a single opaque string, match neither
// GPL_FAMILY_IDS nor PERMISSIVE_IDS (both keyed on bare single ids), and
// silently fall to the conservative "proprietary" default — with no warning
// that a multi-license expression had been collapsed. Now the expression is
// parsed and reduced via mostPermissiveBranch (the SAME function already
// used for package-side OR resolution in licenseResolver.ts), so the mode is
// derived from the resolved branch's ids instead of the raw expression text.
function deriveProjectLicenseMode(spdxId) {
    if (spdxId === 'proprietary' || spdxId === '')
        return 'proprietary';
    const parsed = (0, spdxParser_1.parseSpdxExpression)(spdxId);
    if (parsed.ok && parsed.expr.type !== 'license') {
        const branchIds = (0, spdxParser_1.mostPermissiveBranch)(parsed.expr, permissiveIds_1.PERMISSIVE_IDS);
        return deriveProjectLicenseModeFromIds(branchIds);
    }
    // Plain single license id (parsed.expr.type === 'license'), or genuinely
    // unparseable input reaching this function directly (e.g. a unit test
    // calling it with garbage) — treat the whole string as one id, matching
    // the original behavior exactly.
    return deriveProjectLicenseModeFromIds([spdxId]);
}
let explanations;
function explanationText(key) {
    if (!explanations)
        explanations = JSON.parse(fs.readFileSync(path.join(paths_1.DATA_DIR, 'conflict-explanations.json'), 'utf8')).explanations;
    const text = explanations[key];
    if (!text)
        throw new Error(`Missing conflict explanation for reason code "${key}"`);
    return text;
}
function checkConflicts(category, licenseIds, mode) {
    const agplNetworkedUse = licenseIds.some((id) => id.startsWith('AGPL-'));
    // Touching explanationText validates the key exists in the vendored data at
    // call time — cheap, and catches a typo'd reason code immediately rather
    // than only when a report tries to render it.
    if (agplNetworkedUse)
        explanationText('agpl-networked-use');
    if (category === 'noncommercial')
        return { level: 'CONFLICT', explanationKey: 'noncommercial-conflict', agplNetworkedUse };
    if (category === 'unknown')
        return { level: 'REVIEW', explanationKey: 'unknown-review', agplNetworkedUse };
    if (category === 'strong-copyleft') {
        if (agplNetworkedUse)
            return { level: 'CONFLICT', explanationKey: 'agpl-networked-use', agplNetworkedUse };
        if (mode === 'proprietary')
            return { level: 'CONFLICT', explanationKey: 'strong-copyleft-in-proprietary', agplNetworkedUse };
        if (mode === 'permissive')
            return { level: 'REVIEW', explanationKey: 'copyleft-in-permissive-project', agplNetworkedUse };
        return { level: 'NONE', explanationKey: null, agplNetworkedUse };
    }
    if (category === 'weak-copyleft')
        return { level: 'REVIEW', explanationKey: 'weak-copyleft-review', agplNetworkedUse };
    if (mode === 'gpl-family' && licenseIds.includes('Apache-2.0')) {
        return { level: 'REVIEW', explanationKey: 'gpl-apache-incompatibility', agplNetworkedUse };
    }
    return { level: 'NONE', explanationKey: null, agplNetworkedUse };
}
//# sourceMappingURL=conflicts.js.map