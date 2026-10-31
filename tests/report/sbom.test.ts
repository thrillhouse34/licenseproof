import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildReportData } from '../../src/report/reportData';
import { renderCycloneDx } from '../../src/report/sbom/cyclonedx';
import { renderSpdx } from '../../src/report/sbom/spdx';

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');
const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

function loadSchema(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
}

// A shared Ajv configured for validating vendored third-party draft-07 schemas:
// strict:false so Ajv doesn't throw on the schemas' own vendor-specific quirks,
// allErrors so a failure reports the FULL error list (printed below) instead of
// stopping at the first.
function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv); // registers date-time (used by CycloneDX metadata.timestamp) etc.
  // ajv-formats in this version doesn't register these two; our generated docs
  // never emit fields that use them, so a permissive stub keeps validation
  // complete (no "unknown format" gaps) without over-constraining.
  ajv.addFormat('iri-reference', true);
  ajv.addFormat('idn-email', true);
  return ajv;
}

async function reportData(fixture: string, productionOnly = false) {
  return buildReportData(path.join(FIXTURES, fixture), { productionOnly });
}

describe('renderCycloneDx — schema conformance + shape', () => {
  it('produces a document that validates against the real CycloneDX 1.5 schema', async () => {
    const ajv = makeAjv();
    // The CycloneDX schema $refs two external schemas by relative id, resolved
    // against its own $id base (http://cyclonedx.org/schema/bom-1.5.schema.json).
    // Register permissive stubs at those ABSOLUTE resolved URIs so the schema
    // compiles offline: `spdx.schema.json` (the SPDX license-id enum — accept any
    // string; the id is separately a real SPDX id in our data) and
    // `jsf-0.82.schema.json` (only used by the top-level `signature` field we
    // never emit).
    ajv.addSchema({ $id: 'http://cyclonedx.org/schema/spdx.schema.json', type: 'string' });
    ajv.addSchema({ $id: 'http://cyclonedx.org/schema/jsf-0.82.schema.json', definitions: { signature: {} } });
    const validate = ajv.compile(loadSchema('cyclonedx-1.5.schema.json'));

    const data = await reportData('pypi-dogfood-mixed', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const ok = validate(doc);
    if (!ok) console.error('CycloneDX validation errors:', JSON.stringify(validate.errors, null, 2));
    expect(ok).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('sets the required top-level fields and a well-formed urn:uuid serialNumber', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    const doc = JSON.parse(renderCycloneDx(data));
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(doc.specVersion).toBe('1.5');
    expect(doc.version).toBe(1);
    expect(doc.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(doc.metadata.timestamp).toBe(data.scanTimestamp);
    expect(doc.metadata.tools[0]).toMatchObject({ name: 'licenseproof', version: data.toolVersion });
    expect(doc.metadata.component).toMatchObject({ type: 'application', name: data.projectName });
    expect(doc.components).toHaveLength(data.packages.length);
  });

  it('emits a scoped-npm purl on a component', async () => {
    const data = await reportData('pypi-dogfood-mixed', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const scoped = doc.components.find((c: { name: string }) => c.name === '@jridgewell/sourcemap-codec');
    expect(scoped).toBeDefined();
    expect(scoped.purl).toBe(`pkg:npm/%40jridgewell/sourcemap-codec@${scoped.version}`);
  });

  it('uses license.id for a clean single SPDX id', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const express = doc.components.find((c: { name: string }) => c.name === 'express');
    expect(express.licenses).toEqual([{ license: { id: 'MIT' } }]);
  });

  it('uses the expression form for a multi-id OR expression', async () => {
    const data = await reportData('resolve-01-dual-license', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const dual = doc.components.find((c: { name: string }) => c.name === 'dual-licensed-pkg');
    expect(dual.licenses).toEqual([{ expression: 'MIT OR GPL-3.0' }]);
  });

  it('uses the expression form for a single-id WITH-exception expression', async () => {
    const data = await reportData('resolve-09-with-exception', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const withExc = doc.components.find((c: { name: string }) => c.name === 'classpath-licensed-pkg');
    expect(withExc.licenses).toEqual([{ expression: 'GPL-2.0-only WITH Classpath-exception-2.0' }]);
  });

  it('omits licenses for an UNKNOWN-resolved package (no fabricated id)', async () => {
    const data = await reportData('resolve-03-missing-license', false);
    const doc = JSON.parse(renderCycloneDx(data));
    const mystery = doc.components.find((c: { name: string }) => c.name === 'mystery-pkg');
    expect(mystery).toBeDefined();
    expect(mystery.licenses).toBeUndefined();
  });

  it('uses license.name (not license.id or expression) for a fingerprint-matched "-like (modified)" license, and still validates against the schema', async () => {
    const ajv = makeAjv();
    ajv.addSchema({ $id: 'http://cyclonedx.org/schema/spdx.schema.json', type: 'string' });
    ajv.addSchema({ $id: 'http://cyclonedx.org/schema/jsf-0.82.schema.json', definitions: { signature: {} } });
    const validate = ajv.compile(loadSchema('cyclonedx-1.5.schema.json'));

    const data = await reportData('resolve-05-modified-license-text', false);
    const doc = JSON.parse(renderCycloneDx(data));

    const ok = validate(doc);
    if (!ok) console.error('CycloneDX validation errors:', JSON.stringify(validate.errors, null, 2));
    expect(ok).toBe(true);
    expect(validate.errors).toBeNull();

    const modified = doc.components.find((c: { name: string }) => c.name === 'modified-mit-pkg');
    expect(modified).toBeDefined();
    // Fuzzy fingerprint match at low confidence — must be the license.name form,
    // never license.id (that would falsely assert a confirmed exact SPDX id for
    // a match that was only a modified-text fingerprint) and never the
    // expression tuple form (there's exactly one resolved id, no OR/AND/WITH).
    expect(modified.licenses).toEqual([{ license: { name: 'MIT-like (modified)' } }]);
    expect(modified.licenses[0].license.id).toBeUndefined();
    expect(modified.licenses[0].expression).toBeUndefined();
  });
});

describe('renderSpdx — schema conformance + shape', () => {
  it('produces a document that validates against the real SPDX 2.3 schema', async () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema('spdx-2.3.schema.json'));

    const data = await reportData('pypi-dogfood-mixed', false);
    const doc = JSON.parse(renderSpdx(data));
    const ok = validate(doc);
    if (!ok) console.error('SPDX validation errors:', JSON.stringify(validate.errors, null, 2));
    expect(ok).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('sets the required top-level document fields', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    const doc = JSON.parse(renderSpdx(data));
    expect(doc.spdxVersion).toBe('SPDX-2.3');
    expect(doc.dataLicense).toBe('CC0-1.0');
    expect(doc.SPDXID).toBe('SPDXRef-DOCUMENT');
    expect(doc.name).toBe(data.projectName);
    expect(doc.documentNamespace).toContain('https://licenseproof.dev/spdxdocs/');
    expect(doc.creationInfo.created).toBe(data.scanTimestamp.replace(/\.\d+Z$/, 'Z'));
    expect(doc.creationInfo.creators).toEqual([`Tool: licenseproof-${data.toolVersion}`]);
    expect(doc.packages).toHaveLength(data.packages.length);
  });

  // Regression guard for the 0.3.4 bug: `creationInfo.created` carried the
  // milliseconds from `new Date().toISOString()`, e.g.
  // "2026-10-31T15:43:32.987Z". The vendored SPDX 2.3 JSON schema types that
  // field as a plain string with no `pattern`, so schema validation above passed
  // it happily — but SPDX 2.3 specifies the literal format
  // `YYYY-MM-DDThh:mm:ssZ`, and the official validator (`pyspdxtools`, the
  // spdx-tools Python package) parses it with exactly that and fails:
  //   Error while parsing Document:
  //   ["time data '2026-10-31T15:43:32.987Z' does not match format '%Y-%m-%dT%H:%M:%SZ'"]
  // This asserts the same grammar pyspdxtools enforces, in-process, so the
  // suite needs no Python, no venv and no network to catch a regression.
  const SPDX_CREATED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  it('emits creationInfo.created in the exact SPDX 2.3 datetime format, with no fractional seconds', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    // Prove the input really does have the milliseconds that used to leak through,
    // so this test cannot pass vacuously if scanTimestamp ever loses them upstream.
    expect(data.scanTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const doc = JSON.parse(renderSpdx(data));
    expect(doc.creationInfo.created).toMatch(SPDX_CREATED);
    // Same instant, just truncated — not a re-stamped or shifted time.
    expect(Date.parse(doc.creationInfo.created)).toBe(
      Math.floor(Date.parse(data.scanTimestamp) / 1000) * 1000,
    );
  });

  it('strips any sub-second precision, not just a 3-digit millisecond field', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    for (const stamp of [
      '2026-10-31T15:43:32.987Z',
      '2026-10-31T15:43:32.9Z',
      '2026-10-31T15:43:32.987654Z',
      '2026-10-31T15:43:32Z', // already clean — must pass through untouched
    ]) {
      const doc = JSON.parse(renderSpdx({ ...data, scanTimestamp: stamp }));
      expect(doc.creationInfo.created).toBe('2026-10-31T15:43:32Z');
    }
  });

  it('gives every package a UNIQUE SPDXID across a large real dependency tree', async () => {
    const data = await reportData('pypi-dogfood-mixed', false);
    expect(data.packages.length).toBeGreaterThan(50); // enough packages to make a collision plausible
    const doc = JSON.parse(renderSpdx(data));
    const ids = doc.packages.map((p: { SPDXID: string }) => p.SPDXID);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^SPDXRef-Package-[0-9]+-[A-Za-z0-9.-]+$/);
  });

  it('documentDescribes lists exactly the direct packages, and DESCRIBES relationships mirror it', async () => {
    const data = await reportData('mixed-npm-pypi-full', false);
    const doc = JSON.parse(renderSpdx(data));
    const directCount = data.packages.filter((p) => p.direct).length;
    expect(doc.documentDescribes).toHaveLength(directCount);
    expect(doc.relationships).toHaveLength(directCount);
    for (const rel of doc.relationships) {
      expect(rel.spdxElementId).toBe('SPDXRef-DOCUMENT');
      expect(rel.relationshipType).toBe('DESCRIBES');
      expect(doc.documentDescribes).toContain(rel.relatedSpdxElement);
    }
  });

  it('reports an UNKNOWN-resolved package as NOASSERTION, not a fabricated license', async () => {
    const data = await reportData('resolve-03-missing-license', false);
    const doc = JSON.parse(renderSpdx(data));
    const mystery = doc.packages.find((p: { name: string }) => p.name === 'mystery-pkg');
    expect(mystery.licenseConcluded).toBe('NOASSERTION');
    expect(mystery.licenseDeclared).toBe('NOASSERTION');
    expect(mystery.downloadLocation).toBe('NOASSERTION');
  });

  it('carries the resolved expression string verbatim for a multi-license package', async () => {
    const data = await reportData('resolve-01-dual-license', false);
    const doc = JSON.parse(renderSpdx(data));
    const dual = doc.packages.find((p: { name: string }) => p.name === 'dual-licensed-pkg');
    expect(dual.licenseConcluded).toBe('MIT OR GPL-3.0');
    expect(dual.licenseDeclared).toBe('MIT OR GPL-3.0');
  });
});
