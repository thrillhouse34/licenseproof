import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectYarnLockFormat, parseYarnClassicLock, parseYarnBerryLock } from '../../../src/ecosystems/npm/yarnLockParser';

function readFixture(dir: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', dir, 'yarn.lock'), 'utf8');
}

describe('detectYarnLockFormat', () => {
  it('detects classic v1 by absence of __metadata', () => {
    expect(detectYarnLockFormat(readFixture('yarn-classic-basic'))).toBe('classic');
  });
  it('detects berry by presence of __metadata', () => {
    expect(detectYarnLockFormat(readFixture('yarn-berry-basic'))).toBe('berry');
  });
});

const ROOT_DEPENDENCY_RANGES = { express: '^4.18.0', typescript: '^5.6.0' }; // matches both fixtures' package.json

describe('parseYarnClassicLock', () => {
  it('resolves direct and transitive deps by descriptor matching, with reachability-based dev flag', () => {
    const result = parseYarnClassicLock(readFixture('yarn-classic-basic'), { productionOnly: false }, ROOT_DEPENDENCY_RANGES, ['typescript']);
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.version).toBe('4.18.2');
    expect(express.direct).toBe(true);
    expect(express.dev).toBe(false);
    expect(express.paths).toEqual([['express']]);
    expect(express.pathCountAtLeast).toBe(1);

    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.direct).toBe(false);
    expect(bodyParser.paths).toEqual([['express', 'body-parser']]);
    expect(bodyParser.pathCountAtLeast).toBe(1);

    const ts = result.packages.find((p) => p.name === 'typescript')!;
    expect(ts.direct).toBe(true);
    expect(ts.dev).toBe(true);
  });

  it('excludes dev packages when productionOnly is true', () => {
    const result = parseYarnClassicLock(readFixture('yarn-classic-basic'), { productionOnly: true }, ROOT_DEPENDENCY_RANGES, ['typescript']);
    expect(result.packages.find((p) => p.name === 'typescript')).toBeUndefined();
  });
});

describe('parseYarnBerryLock', () => {
  it('resolves direct and transitive deps by descriptor matching, with reachability-based dev flag', () => {
    const result = parseYarnBerryLock(readFixture('yarn-berry-basic'), { productionOnly: false }, ROOT_DEPENDENCY_RANGES, ['typescript']);
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.version).toBe('4.18.2');
    expect(express.direct).toBe(true);
    expect(express.paths).toEqual([['express']]);
    expect(express.pathCountAtLeast).toBe(1);

    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.direct).toBe(false);
    expect(bodyParser.paths).toEqual([['express', 'body-parser']]);
    expect(bodyParser.pathCountAtLeast).toBe(1);

    const ts = result.packages.find((p) => p.name === 'typescript')!;
    expect(ts.direct).toBe(true);
    expect(ts.dev).toBe(true);
  });

  it('surfaces a package reachable only via optionalDependencies (not dependencies)', () => {
    const rootRanges = { ...ROOT_DEPENDENCY_RANGES, 'build-tool': '^1.0.0' };
    const result = parseYarnBerryLock(readFixture('yarn-berry-basic'), { productionOnly: false }, rootRanges, ['typescript']);
    const nativeAddon = result.packages.find((p) => p.name === 'native-addon')!;
    expect(nativeAddon).toBeDefined();
    expect(nativeAddon.paths).toEqual([['build-tool', 'native-addon']]);
  });
});
