import { describe, it, expect } from 'vitest';
import { parseMetadata } from '../../src/resolve/pypiMetadata';

describe('parseMetadata (.dist-info/METADATA RFC822 header parser)', () => {
  it('extracts License-Expression, License, and all classifiers', () => {
    const md = parseMetadata(
      [
        'Metadata-Version: 2.4',
        'Name: example',
        'Version: 1.0.0',
        'License-Expression: MIT',
        'License: MIT License',
        'Classifier: Development Status :: 5 - Production/Stable',
        'Classifier: License :: OSI Approved :: MIT License',
        'Classifier: Programming Language :: Python :: 3',
      ].join('\n'),
    );
    expect(md.licenseExpression).toBe('MIT');
    expect(md.license).toBe('MIT License');
    // ALL classifiers are collected, not just license ones — filtering happens
    // at consumption, not parse time.
    expect(md.classifiers).toEqual([
      'Development Status :: 5 - Production/Stable',
      'License :: OSI Approved :: MIT License',
      'Programming Language :: Python :: 3',
    ]);
  });

  it('stops parsing at the first blank line — body prose is not parsed as fields', () => {
    const md = parseMetadata(
      [
        'Metadata-Version: 2.1',
        'Name: example',
        'License: MIT',
        '',
        'This description body mentions License: GPL-3.0-only which must be ignored.',
      ].join('\n'),
    );
    expect(md.license).toBe('MIT'); // NOT overwritten by the body line
  });

  it('handles a field with no value (empty after the colon)', () => {
    const md = parseMetadata(['Name: example', 'License:', 'Version: 1.0.0'].join('\n'));
    expect(md.license).toBe('');
  });

  it('last occurrence wins for a defensively-repeated single-value field', () => {
    const md = parseMetadata(['License: MIT', 'License: Apache-2.0'].join('\n'));
    expect(md.license).toBe('Apache-2.0');
  });

  it('accumulates a continuation line (leading whitespace) into the previous field, defensively', () => {
    const md = parseMetadata(['License: Some very long', '    license text continued'].join('\n'));
    expect(md.license).toBe('Some very long license text continued');
  });

  it('a continuation after a Classifier appends to the last classifier, not a new one', () => {
    const md = parseMetadata(
      ['Classifier: License :: OSI Approved', '    :: MIT License'].join('\n'),
    );
    expect(md.classifiers).toEqual(['License :: OSI Approved :: MIT License']);
  });

  it('does not crash on a leading-whitespace continuation with no preceding field', () => {
    expect(() => parseMetadata('    orphan continuation with no field\nName: x')).not.toThrow();
    const md = parseMetadata('    orphan continuation with no field\nName: x');
    expect(md.classifiers).toEqual([]);
    expect(md.license).toBeUndefined();
    expect(md.licenseExpression).toBeUndefined();
  });

  it('returns empty defaults for an empty file', () => {
    const md = parseMetadata('');
    expect(md).toEqual({ licenseExpression: undefined, license: undefined, classifiers: [] });
  });

  it('handles CRLF line endings', () => {
    const md = parseMetadata('Name: example\r\nLicense-Expression: Apache-2.0\r\n');
    expect(md.licenseExpression).toBe('Apache-2.0');
  });
});
