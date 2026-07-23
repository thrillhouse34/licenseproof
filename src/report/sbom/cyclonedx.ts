import { randomUUID } from 'crypto';
import type { ResolvedPackage } from '../../resolve/types';
import type { ReportData } from '../reportData';
import { toPurl } from './purl';

/**
 * Render a schema-valid CycloneDX 1.5 BOM (JSON) from the shared ReportData.
 * Validated against the vendored real CycloneDX 1.5 schema in the test suite
 * (`tests/schemas/cyclonedx-1.5.schema.json`).
 */

// A compound SPDX expression is anything with more than one resolved id or an
// explicit OR/AND/WITH operator. CycloneDX's `licenseChoice` is a strict `oneOf`:
// EITHER a list of `{ license: { id | name } }` objects OR a single-element tuple
// `[{ expression }]` — the two forms cannot be mixed, so a compound expression
// MUST use the expression form and a clean single id uses the license.id form.
function isCompoundExpression(pkg: ResolvedPackage): boolean {
  return pkg.licenseIds.length > 1 || / (OR|AND|WITH) /.test(pkg.license);
}

function licensesFor(pkg: ResolvedPackage): unknown[] | undefined {
  if (pkg.licenseIds.length === 0) {
    // No resolved SPDX id (UNKNOWN / UNLICENSED / unresolved). CycloneDX has no
    // SPDX-style NOASSERTION concept, so the honest representation is to omit the
    // `licenses` field entirely rather than assert a license we never resolved.
    return undefined;
  }
  if (isCompoundExpression(pkg)) {
    // "SPDX License Expression" tuple form — exactly one element, per the schema's
    // licenseChoice `oneOf` second branch.
    return [{ expression: pkg.license }];
  }
  const id = pkg.licenseIds[0];
  if (pkg.license === id) {
    // Clean single SPDX id -> the `license.id` form (validated against SPDX ids).
    return [{ license: { id } }];
  }
  // One id resolved but the display string differs from it (e.g. a
  // fingerprint-matched "MIT-like (modified)") — that string is neither a clean
  // SPDX id nor a real SPDX expression, so record it as a named (non-SPDX)
  // license via `license.name` rather than fabricating a false SPDX id.
  return [{ license: { name: pkg.license } }];
}

export function renderCycloneDx(data: ReportData): string {
  const components = data.packages.map((pkg) => {
    const component: Record<string, unknown> = {
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: toPurl(pkg),
    };
    const licenses = licensesFor(pkg);
    if (licenses) component.licenses = licenses;
    return component;
  });

  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    // RFC-4122 urn:uuid — matches the schema's serialNumber pattern. Node's
    // built-in randomUUID() emits a lowercase v4 UUID, no new dependency.
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: data.scanTimestamp,
      // Legacy `tools` array form (schema oneOf branch 2) — one entry describing
      // licenseproof itself as the BOM's creating tool, stamped with its real
      // running version.
      tools: [
        {
          vendor: 'licenseproof',
          name: 'licenseproof',
          version: data.toolVersion,
        },
      ],
      // The scanned project itself as the BOM subject.
      component: {
        type: 'application',
        name: data.projectName,
      },
    },
    components,
  };

  return JSON.stringify(doc, null, 2) + '\n';
}
