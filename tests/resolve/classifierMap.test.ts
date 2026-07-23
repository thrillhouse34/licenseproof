import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../../src/paths';
import { mapClassifierToSpdxId } from '../../src/resolve/classifierMap';
import { isKnownSpdxId } from '../../src/resolve/spdxData';
import { categorizeLicenseId } from '../../src/rules/categories';

describe('mapClassifierToSpdxId', () => {
  it('maps a well-known OSI-approved classifier to its SPDX id', () => {
    expect(mapClassifierToSpdxId('License :: OSI Approved :: MIT License')).toBe('MIT');
    expect(mapClassifierToSpdxId('License :: OSI Approved :: Apache Software License')).toBe('Apache-2.0');
    expect(mapClassifierToSpdxId('License :: OSI Approved :: GNU Affero General Public License v3')).toBe('AGPL-3.0-only');
  });

  it('maps the ambiguous BSD License classifier to the most common representative id, documented as ambiguous', () => {
    expect(mapClassifierToSpdxId('License :: OSI Approved :: BSD License')).toBe('BSD-3-Clause');
  });

  it('maps the non-OSI CC0 classifier', () => {
    expect(mapClassifierToSpdxId('License :: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication')).toBe('CC0-1.0');
  });

  it('returns undefined for an unmapped/unrecognized classifier', () => {
    expect(mapClassifierToSpdxId('License :: Other/Proprietary License')).toBeUndefined();
    expect(mapClassifierToSpdxId('License :: Public Domain')).toBeUndefined();
    expect(mapClassifierToSpdxId('Not a real classifier')).toBeUndefined();
  });

  it('every mapped SPDX id is a known vendored SPDX id with a real (non-unknown) category', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classifier-to-spdx.json'), 'utf8'));
    const entries = Object.entries(raw.classifiers) as Array<[string, string]>;
    expect(entries.length).toBeGreaterThan(20);
    for (const [classifier, spdxId] of entries) {
      expect(isKnownSpdxId(spdxId), `${classifier} -> ${spdxId} is not a known SPDX id`).toBe(true);
      expect(categorizeLicenseId(spdxId), `${classifier} -> ${spdxId} has no category`).not.toBe('unknown');
    }
  });

  it('the data file declares schemaVersion 1 and a non-trivial note', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classifier-to-spdx.json'), 'utf8'));
    expect(raw.schemaVersion).toBe(1);
    expect(typeof raw.note).toBe('string');
    expect(raw.note.length).toBeGreaterThan(50);
  });
});
