"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_ORDER = void 0;
exports.classifySeverity = classifySeverity;
// Rendering order for both the terminal summary and (as a secondary sort
// key) JSON output — kept in exactly one place so the two renderers can
// never silently diverge, unlike the PERMISSIVE_IDS duplication this
// milestone's pre-work fixed.
exports.SEVERITY_ORDER = ['conflict', 'agpl-informational', 'review', 'unknown', 'clean'];
function classifySeverity(pkg) {
    if (pkg.conflict.level === 'CONFLICT')
        return 'conflict';
    if (pkg.category === 'unknown')
        return 'unknown'; // always its own bucket, even though unknown also carries REVIEW level — never buried in a generic review list
    if (pkg.conflict.level === 'REVIEW')
        return 'review';
    if (pkg.conflict.agplNetworkedUse)
        return 'agpl-informational'; // AGPL present only as a non-chosen OR branch; the chosen branch itself is clean
    return 'clean';
}
//# sourceMappingURL=severity.js.map