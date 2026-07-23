"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScan = runScan;
const reportData_1 = require("../report/reportData");
const summary_1 = require("../report/summary");
const json_1 = require("../report/json");
function computeExitCode(packages, failOn) {
    if (failOn === 'never')
        return 0;
    const hasConflict = packages.some((p) => p.conflict.level === 'CONFLICT');
    const hasReviewOrUnknown = packages.some((p) => p.conflict.level === 'REVIEW');
    if (failOn === 'review')
        return hasConflict || hasReviewOrUnknown ? 1 : 0;
    return hasConflict ? 1 : 0; // 'conflict', the default
}
async function runScan(opts) {
    try {
        // The detect+scan+merge+resolve+stamp sequence now lives in the shared
        // buildReportData (src/report/reportData.ts) so `scan` and the M5 `report`
        // command render from identical data. A NoProjectFoundError thrown from
        // there is caught below and formatted into the same one-line exit-2 message
        // the old inline early-return produced (its `.message` is the exact
        // marker-listing sentence, and the catch prefixes `licenseproof: `).
        const data = await (0, reportData_1.buildReportData)(opts.path, {
            productionOnly: opts.productionOnly,
            projectLicenseOverride: opts.projectLicenseOverride,
        });
        let output = opts.format === 'json'
            ? JSON.stringify((0, json_1.buildJsonReport)(data), null, 2)
            : (0, summary_1.renderSummary)({
                ...data,
                colorEnabled: opts.colorEnabled ?? (process.stdout.isTTY === true && process.env.NO_COLOR === undefined),
            });
        // Funnel nudge on the FREE `scan` command (scan-only — never in `report`).
        // Appended when the summary shows at least one real CONFLICT and stdout is
        // an interactive TTY. This is a raw `process.stdout.isTTY` check, DELIBERATELY
        // INDEPENDENT of --no-color / NO_COLOR / colorEnabled: it is a plain
        // one-line text nudge, not colored output, so a user who disabled ANSI color
        // still sees it. Never appears in JSON output (guarded by the summary check),
        // and never appears twice.
        if (opts.format === 'summary' &&
            process.stdout.isTTY === true &&
            data.packages.some((p) => p.conflict.level === 'CONFLICT')) {
            output += '\nGenerate a lawyer-ready report of these findings: licenseproof.dev';
        }
        return { exitCode: computeExitCode(data.packages, opts.failOn), output };
    }
    catch (err) {
        return { exitCode: 2, output: `licenseproof: ${err.message}` };
    }
}
//# sourceMappingURL=scan.js.map