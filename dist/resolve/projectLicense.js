"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProjectLicenseContext = resolveProjectLicenseContext;
const spdxParser_1 = require("./spdxParser");
const UNSPECIFIED = { displayId: 'unspecified', modeId: 'proprietary', wasUnspecified: true };
function resolveProjectLicenseContext(manifestLicenseRaw, cliOverride) {
    const raw = cliOverride ?? manifestLicenseRaw;
    if (!raw || !raw.trim())
        return UNSPECIFIED;
    const parsed = (0, spdxParser_1.parseSpdxExpression)(raw);
    if (!parsed.ok)
        return UNSPECIFIED;
    return { displayId: raw, modeId: raw, wasUnspecified: false };
}
//# sourceMappingURL=projectLicense.js.map