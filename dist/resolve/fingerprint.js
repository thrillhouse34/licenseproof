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
exports.fingerprintLicenseText = fingerprintLicenseText;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const paths_1 = require("../paths");
function normalizeTokens(text) {
    const cleaned = text
        .toLowerCase()
        .replace(/copyright\s*\(c\)?\s*\d{0,4}[^\n]*/gi, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return new Set(cleaned.split(' ').filter(Boolean));
}
function jaccardSimilarity(a, b) {
    let intersection = 0;
    for (const tok of a)
        if (b.has(tok))
            intersection++;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
let cachedTexts;
function loadVendoredTexts() {
    if (!cachedTexts) {
        const dir = path.join(paths_1.DATA_DIR, 'license-texts');
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')) : [];
        cachedTexts = files.map((f) => ({
            licenseId: f.replace(/\.txt$/, ''),
            tokens: normalizeTokens(fs.readFileSync(path.join(dir, f), 'utf8')),
        }));
    }
    return cachedTexts;
}
const MIN_SIMILARITY = 0.75;
function fingerprintLicenseText(text) {
    const candidateTokens = normalizeTokens(text);
    let best = null;
    for (const v of loadVendoredTexts()) {
        const similarity = jaccardSimilarity(candidateTokens, v.tokens);
        if (!best || similarity > best.similarity)
            best = { licenseId: v.licenseId, similarity };
    }
    return best && best.similarity >= MIN_SIMILARITY ? best : null;
}
//# sourceMappingURL=fingerprint.js.map