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
exports.EXIT_UNLICENSED = exports.REPORT_FORMATS = void 0;
exports.runReport = runReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const reportData_1 = require("../report/reportData");
const html_1 = require("../report/html");
const pdf_1 = require("../report/pdf");
const notices_1 = require("../report/notices");
const cyclonedx_1 = require("../report/sbom/cyclonedx");
const spdx_1 = require("../report/sbom/spdx");
const discovery_1 = require("../license/discovery");
const verify_1 = require("../license/verify");
const dataCurrency_1 = require("../license/dataCurrency");
exports.REPORT_FORMATS = ['html', 'pdf', 'notices', 'sbom-cyclonedx', 'sbom-spdx'];
/**
 * The formats that require a valid paid license key. `sbom-cyclonedx` is the one
 * free `report` format (the same machine-readable SBOM the free tier promises);
 * everything else is a paid, audit-ready artifact.
 */
const GATED_FORMATS = new Set([
    'html',
    'pdf',
    'notices',
    'sbom-spdx',
]);
/** New exit code (distinct from `report`'s existing 0/2): request refused for lack of a key. */
exports.EXIT_UNLICENSED = 3;
/**
 * The friendly, non-naggy refusal shown when a gated format is requested without
 * a valid key. States what the paid report includes, the price, and where to buy.
 */
const UNLICENSED_MESSAGE = [
    'This report format needs a LicenseProof license.',
    '',
    'The paid report gives you audit-ready HTML and PDF reports, third-party',
    'notices, and SBOM output. It is a perpetual license: $29 individual, $99',
    'agency. See samples and buy a key at https://licenseproof.dev',
    '',
    'Already have a key? Run:  licenseproof activate <key>',
    'The free scan, JSON output, and sbom-cyclonedx never need a key.',
].join('\n');
/** Default per-format filenames used whenever `--out` names a directory (or is omitted). */
const DEFAULT_FILENAMES = {
    html: 'report.html',
    pdf: 'report.pdf',
    notices: 'THIRD_PARTY_NOTICES.txt',
    'sbom-cyclonedx': 'sbom.cyclonedx.json',
    'sbom-spdx': 'sbom.spdx.json',
};
/** Default output directory when `--out` is omitted, matching the v1 spec's `--output <dir>` default. */
const DEFAULT_OUT_DIR = './licenseproof-report';
const VALID_LIST = exports.REPORT_FORMATS.join(', ');
/** Produce the artifact bytes for one format. String artifacts and the binary PDF are both handled. */
async function renderFormat(fmt, data) {
    switch (fmt) {
        case 'html':
            return (0, html_1.renderHtml)(data);
        case 'pdf':
            // The PDF is the HTML report printed through a real browser — same single
            // renderer, so the two artifacts can never drift. `data` is passed too:
            // the PDF's per-page footer needs the provenance fields directly (see
            // src/report/pdf.ts).
            return (0, pdf_1.renderPdf)((0, html_1.renderHtml)(data), data);
        case 'notices':
            return (0, notices_1.renderNotices)(data);
        case 'sbom-cyclonedx':
            return (0, cyclonedx_1.renderCycloneDx)(data);
        case 'sbom-spdx':
            return (0, spdx_1.renderSpdx)(data);
    }
}
/**
 * Validate + de-duplicate the requested formats. Returns the ordered unique
 * format list on success, or an error message string on failure (unknown value
 * or empty request) — never silently drops a typo'd format.
 */
function validateFormats(requested) {
    if (requested.length === 0) {
        return { error: `licenseproof report: at least one --format is required (${VALID_LIST}).` };
    }
    const seen = new Set();
    const formats = [];
    for (const raw of requested) {
        const value = raw.trim();
        if (!exports.REPORT_FORMATS.includes(value)) {
            return { error: `licenseproof report: unknown format "${raw}". Valid formats: ${VALID_LIST}.` };
        }
        if (!seen.has(value)) {
            seen.add(value);
            formats.push(value);
        }
    }
    return { formats };
}
/**
 * `--out` reconciliation (documented in the CLI --help and README): honor `--out`
 * as a literal file path ONLY when exactly one format was requested; otherwise
 * (multiple formats, or `--out` omitted) treat it as an output DIRECTORY and
 * write each artifact under it with its default filename. When `--out` is omitted
 * entirely, default to ./licenseproof-report/ regardless of format count. Returns
 * the absolute target path for each requested format.
 */
function resolveOutputTargets(formats, out) {
    if (out !== undefined && formats.length === 1) {
        return [{ format: formats[0], target: path.resolve(out) }];
    }
    const dir = path.resolve(out ?? DEFAULT_OUT_DIR);
    return formats.map((format) => ({ format, target: path.join(dir, DEFAULT_FILENAMES[format]) }));
}
async function runReport(opts) {
    // Validate formats FIRST, before any scan work or filesystem writes, so an
    // unknown/typo'd format fails cleanly with nothing written.
    const validated = validateFormats(opts.formats);
    if ('error' in validated) {
        return { exitCode: 2, output: validated.error };
    }
    const formats = validated.formats;
    // GATING — WHOLE-REQUEST, NOT PER-ARTIFACT (deliberate design decision).
    //
    // If ANY requested format in this single invocation is gated, the request
    // needs a valid key; without one we refuse the ENTIRE request (write nothing,
    // exit 3) even if a free `sbom-cyclonedx` was also requested alongside. A
    // request for ONLY `sbom-cyclonedx` (even repeated) needs no key and proceeds
    // exactly as before.
    //
    // Rationale: gating per-artifact-within-one-invocation would mean partially
    // fulfilling a request (writing the free SBOM, skipping the paid HTML) and
    // then having to pick a mixed exit code — a confusing "some of what you asked
    // for" outcome and a write/skip matrix to reason about. Whole-request gating
    // is unambiguous: the invocation either fully succeeds or writes nothing, and
    // it matches how the brief frames the free-cyclonedx path as its own separate
    // step rather than mixed into a gated multi-format request.
    const needsKey = formats.some((f) => GATED_FORMATS.has(f));
    let license = null;
    if (needsKey) {
        const keyString = (0, discovery_1.discoverLicenseKey)({
            cliKey: opts.key,
            env: opts.env,
            keyFilePath: opts.keyFilePath,
        });
        license = keyString ? (0, verify_1.verifyLicenseKey)(keyString) : null;
        if (!license) {
            // Refuse the whole request. Nothing is scanned, nothing is written.
            return { exitCode: exports.EXIT_UNLICENSED, output: UNLICENSED_MESSAGE };
        }
    }
    let data;
    try {
        data = await (0, reportData_1.buildReportData)(opts.path, {
            productionOnly: opts.productionOnly,
            projectLicenseOverride: opts.projectLicenseOverride,
        });
    }
    catch (err) {
        if (err instanceof reportData_1.NoProjectFoundError) {
            // Match the `scan` command's exit-2 "no project" style, extended to name
            // the `report` command. Nothing is written.
            return { exitCode: 2, output: `licenseproof report: ${err.message}. No artifacts were generated.` };
        }
        return { exitCode: 2, output: `licenseproof report: ${err.message}` };
    }
    const targets = resolveOutputTargets(formats, opts.out);
    const written = [];
    try {
        for (const { format, target } of targets) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const content = await renderFormat(format, data);
            fs.writeFileSync(target, content);
            written.push(target);
        }
    }
    catch (err) {
        return { exitCode: 2, output: `licenseproof report: ${err.message}` };
    }
    const lines = [
        `licenseproof: wrote ${written.length} report artifact${written.length === 1 ? '' : 's'}:`,
        ...written.map((w) => `  ${w}`),
    ];
    // Data-currency FYI (addendum §2): when a gated format was generated with a
    // valid key AND the installed reference data postdates the key's update
    // window, append ONE purely informational line. Report generation is
    // perpetual and completely unaffected — this never nags, degrades, or blocks.
    if (license) {
        const note = (0, dataCurrency_1.dataCurrencyNote)(license.updatesUntil, data.dataVersion);
        if (note)
            lines.push('', note);
    }
    return { exitCode: 0, output: lines.join('\n') };
}
//# sourceMappingURL=report.js.map