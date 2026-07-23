"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePyprojectToml = parsePyprojectToml;
const smol_toml_1 = require("smol-toml");
/**
 * Extract the bare distribution name from a PEP 508 requirement string.
 * Examples:
 *   "requests>=2.31.0"          -> "requests"
 *   "requests[security]>=2.31"  -> "requests"
 *   "ruff == 0.1.0"             -> "ruff"
 *   "importlib-metadata; python_version < '3.8'" -> "importlib-metadata"
 * Returns undefined if no leading name can be found (e.g. a URL-only entry).
 */
function nameFromPep508(req) {
    const trimmed = req.trim();
    // Name is the leading run before any of: whitespace, extras `[`, a version
    // operator, a marker `;`, or an `@` (URL form `name @ https://...`).
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed);
    return match ? match[1] : undefined;
}
function namesFromArray(value) {
    if (!Array.isArray(value))
        return [];
    const names = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const name = nameFromPep508(item);
        if (name)
            names.push(name);
    }
    return names;
}
/**
 * Poetry's `[tool.poetry.dependencies]` is a TABLE keyed by package name (values
 * are version constraints / inline tables), NOT an array — so the KEYS are the
 * names. The literal `python` key is a Python-version constraint, not a package
 * dependency, and must be dropped.
 */
function namesFromPoetryTable(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return [];
    return Object.keys(value).filter((k) => k !== 'python');
}
function parsePyprojectToml(contents) {
    let doc;
    try {
        doc = (0, smol_toml_1.parse)(contents);
    }
    catch {
        // A malformed pyproject.toml yields no declared deps rather than crashing
        // the whole scan — the orchestrator surfaces the empty result as an
        // effectively-empty project.
        return { mainDeps: [], groupDeps: {} };
    }
    const project = doc.project;
    // --- PEP 621 standard shape wins when present ---
    if (project) {
        const mainDeps = namesFromArray(project.dependencies);
        const groupDeps = {};
        const optional = project['optional-dependencies'];
        if (optional && typeof optional === 'object' && !Array.isArray(optional)) {
            for (const [groupName, deps] of Object.entries(optional)) {
                groupDeps[groupName] = namesFromArray(deps);
            }
        }
        return { mainDeps, groupDeps };
    }
    // --- Legacy Poetry-only shape ---
    const tool = doc.tool;
    const poetry = tool?.poetry;
    if (poetry) {
        const mainDeps = namesFromPoetryTable(poetry.dependencies);
        const groupDeps = {};
        // Modern grouped form: [tool.poetry.group.<name>.dependencies]
        const group = poetry.group;
        if (group && typeof group === 'object' && !Array.isArray(group)) {
            for (const [groupName, groupBody] of Object.entries(group)) {
                const body = groupBody;
                groupDeps[groupName] = namesFromPoetryTable(body?.dependencies);
            }
        }
        // Legacy flat dev group: [tool.poetry.dev-dependencies]
        const legacyDev = namesFromPoetryTable(poetry['dev-dependencies']);
        if (legacyDev.length > 0) {
            groupDeps['dev'] = [...(groupDeps['dev'] ?? []), ...legacyDev];
        }
        return { mainDeps, groupDeps };
    }
    return { mainDeps: [], groupDeps: {} };
}
//# sourceMappingURL=pyprojectTomlParser.js.map