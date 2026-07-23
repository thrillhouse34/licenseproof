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
exports.runDeactivate = runDeactivate;
const fs = __importStar(require("fs"));
const discovery_1 = require("../license/discovery");
/**
 * `licenseproof deactivate` — remove the stored license key at
 * `~/.config/licenseproof/license.key`. Idempotent: no error if the file is
 * already absent. Prints a confirmation either way, exit code 0. This is the
 * expected pair to `activate` and is what makes the "deactivate → gated format
 * refused" step of the simulated customer journey testable.
 */
function runDeactivate(opts = {}) {
    const target = opts.keyFilePath ?? (0, discovery_1.licenseKeyPath)();
    try {
        if (fs.existsSync(target)) {
            fs.rmSync(target);
            return {
                exitCode: 0,
                output: 'licenseproof: deactivated. The stored license key was removed; the ' +
                    'report command’s paid formats will need a key again.',
            };
        }
    }
    catch (err) {
        // Exceptional (e.g. a permissions problem on the user's own config file).
        // Still exit 0 — deactivate is a "make sure it's gone" operation — but say so.
        return {
            exitCode: 0,
            output: `licenseproof: could not remove ${target}: ${err.message}`,
        };
    }
    return {
        exitCode: 0,
        output: 'licenseproof: no active license key was found. Nothing to remove.',
    };
}
//# sourceMappingURL=deactivate.js.map