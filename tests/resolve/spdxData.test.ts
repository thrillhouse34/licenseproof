import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../../src/paths';
import { normalizeSpdxId, isKnownSpdxId } from '../../src/resolve/spdxData';

describe('vendored SPDX data', () => {
  it('spdx-licenses.json is valid JSON with at least the required IDs', () => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'spdx-licenses.json'), 'utf8'));
    const ids = new Set(data.licenses.map((l: any) => l.licenseId));
    for (const required of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'MPL-2.0', 'Unlicense', '0BSD', 'CC0-1.0']) {
      expect(ids.has(required)).toBe(true);
    }
    expect(data.deprecatedMap['GPL-3.0']).toBe('GPL-3.0-only');
  });

  it('license-categories.json covers every category value from spec §4.3', () => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'license-categories.json'), 'utf8'));
    const categoriesPresent = new Set(Object.values(data.categories));
    for (const cat of ['permissive', 'weak-copyleft', 'strong-copyleft', 'noncommercial', 'public-domain']) {
      expect(categoriesPresent.has(cat)).toBe(true);
    }
    expect(data._disclaimer).toBeDefined();
  });

  it('conflict-explanations.json has an explanation for every reason code used by the rules engine', () => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'conflict-explanations.json'), 'utf8'));
    for (const key of ['strong-copyleft-in-proprietary', 'agpl-networked-use', 'weak-copyleft-review', 'noncommercial-conflict', 'unknown-review', 'copyleft-in-permissive-project', 'gpl-apache-incompatibility']) {
      expect(typeof data.explanations[key]).toBe('string');
      expect(data.explanations[key].length).toBeGreaterThan(20);
    }
    expect(data._disclaimer).toBeDefined();
  });

  it('all 14 required license texts are present and non-trivial', () => {
    const required = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'MPL-2.0', 'Unlicense', '0BSD', 'CC0-1.0'];
    for (const id of required) {
      const text = fs.readFileSync(path.join(DATA_DIR, 'license-texts', `${id}.txt`), 'utf8');
      expect(text.length).toBeGreaterThan(50);
    }
  });
});

describe('normalizeSpdxId / isKnownSpdxId', () => {
  it('normalizes a deprecated id and records that normalization happened', () => {
    const result = normalizeSpdxId('GPL-3.0');
    expect(result.normalized).toBe('GPL-3.0-only');
    expect(result.wasDeprecated).toBe(true);
  });
  it('passes through a current id unchanged', () => {
    expect(normalizeSpdxId('MIT')).toEqual({ normalized: 'MIT', wasDeprecated: false });
  });
  it('recognizes a vendored id', () => {
    expect(isKnownSpdxId('MIT')).toBe(true);
    expect(isKnownSpdxId('Totally-Not-A-License')).toBe(false);
  });
});
