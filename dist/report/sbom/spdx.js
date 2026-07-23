"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSpdx = renderSpdx;
const crypto_1 = require("crypto");
/**
 * Render a schema-valid SPDX 2.3 document (JSON) from the shared ReportData.
 * Validated against the vendored real SPDX 2.3 schema in the test suite
 * (`tests/schemas/spdx-2.3.schema.json`).
 */
/**
 * SPDX element ids conventionally match `SPDXRef-[a-zA-Z0-9.-]+`. Sanitize a
 * package's `name-version` into that charset (every other run of characters
 * becomes a single `-`). Uniqueness across the whole document is guaranteed by
 * ALSO prefixing the package's 1-based position: two distinct packages whose
 * name+version happen to sanitize to the same string (e.g. a scoped `@foo/bar`
 * vs an unscoped `foo-bar` at the same version) would otherwise collide, which
 * would silently produce an invalid document with duplicate SPDXIDs.
 */
function spdxPackageId(pkg, position) {
    const base = `${pkg.name}-${pkg.version}`.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    return `SPDXRef-Package-${position}-${base}`;
}
function renderSpdx(data) {
    // Assign each package its stable SPDXID once, up front, so packages,
    // documentDescribes, and relationships all reference the exact same ids.
    const entries = data.packages.map((pkg, i) => ({ pkg, spdxId: spdxPackageId(pkg, i + 1) }));
    const packages = entries.map(({ pkg, spdxId }) => {
        // An UNKNOWN-resolved package (no SPDX id resolved at all) is reported
        // honestly as NOASSERTION — never a fabricated license string. Everything
        // else uses the resolved display string verbatim (the same string shown in
        // the terminal/JSON output, including full OR/AND/WITH expressions).
        const license = pkg.licenseIds.length === 0 ? 'NOASSERTION' : pkg.license;
        return {
            SPDXID: spdxId,
            name: pkg.name,
            versionInfo: pkg.version,
            // We do not reliably know each package's registry download URL, so we
            // assert nothing rather than guess one.
            downloadLocation: 'NOASSERTION',
            licenseConcluded: license,
            licenseDeclared: license,
        };
    });
    const directIds = entries.filter(({ pkg }) => pkg.direct).map(({ spdxId }) => spdxId);
    // The document DESCRIBES the direct/top-level packages. Full transitive
    // DEPENDS_ON edges are intentionally NOT modeled here: `ResolvedPackage.paths`
    // carries only package *names* (not versioned ids), so mapping a dependency
    // edge to a specific package SPDXID would be ambiguous whenever two versions of
    // the same name coexist in the tree. The package + license list itself is
    // complete and schema-valid — that is the core SBOM value — and DESCRIBES gives
    // an honest, unambiguous relationship set without guessing at edges.
    const relationships = directIds.map((relatedSpdxElement) => ({
        spdxElementId: 'SPDXRef-DOCUMENT',
        relatedSpdxElement,
        relationshipType: 'DESCRIBES',
    }));
    const doc = {
        spdxVersion: 'SPDX-2.3',
        dataLicense: 'CC0-1.0',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: data.projectName,
        // Only required to be unique, not resolvable (SPDX §6.5). The uuid makes every
        // generated document's namespace distinct even for repeat scans of one project.
        documentNamespace: `https://licenseproof.dev/spdxdocs/${encodeURIComponent(data.projectName)}-${(0, crypto_1.randomUUID)()}`,
        creationInfo: {
            created: data.scanTimestamp,
            creators: [`Tool: licenseproof-${data.toolVersion}`],
        },
        documentDescribes: directIds,
        packages,
        relationships,
    };
    return JSON.stringify(doc, null, 2) + '\n';
}
//# sourceMappingURL=spdx.js.map