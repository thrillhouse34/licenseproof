import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parsePackageLock } from '../../../src/ecosystems/npm/packageLockParser';

function readFixtureLock(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', name, 'package-lock.json'), 'utf8');
}

describe('parsePackageLock', () => {
  it('parses a v3 lockfile: direct/transitive, scoped names, license passthrough, dev filtering', () => {
    const result = parsePackageLock(readFixtureLock('package-lock-v3-basic'), { productionOnly: true });
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['@myorg/logger', 'body-parser', 'express']); // typescript excluded: dev + productionOnly

    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.direct).toBe(true);
    expect(express.paths).toEqual([['express']]);
    expect(express.pathCountAtLeast).toBe(1);
    expect(express.licenseRaw).toBe('MIT');

    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.direct).toBe(false);
    expect(bodyParser.paths).toEqual([['express', 'body-parser']]);
    expect(bodyParser.pathCountAtLeast).toBe(1);

    const scoped = result.packages.find((p) => p.name === '@myorg/logger')!;
    expect(scoped.paths).toEqual([['express', '@myorg/logger']]);
    expect(scoped.pathCountAtLeast).toBe(1);
  });

  it('includes dev dependencies when productionOnly is false', () => {
    const result = parsePackageLock(readFixtureLock('package-lock-v3-basic'), { productionOnly: false });
    const ts = result.packages.find((p) => p.name === 'typescript');
    expect(ts).toBeDefined();
    expect(ts!.dev).toBe(true);
    expect(ts!.direct).toBe(true);
  });

  it('parses a v2 lockfile identically to the equivalent v3 lockfile (ignoring the legacy dependencies tree)', () => {
    const v2 = parsePackageLock(readFixtureLock('package-lock-v2-basic'), { productionOnly: true });
    const v3 = parsePackageLock(readFixtureLock('package-lock-v3-basic'), { productionOnly: true });
    const strip = (r: typeof v2) => r.packages.map((p) => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name));
    expect(strip(v2)).toEqual(strip(v3));
  });

  it('caps a circular dependency instead of infinite-looping, counting the closing path once', () => {
    const start = Date.now();
    const result = parsePackageLock(readFixtureLock('package-lock-circular'), { productionOnly: true });
    expect(Date.now() - start).toBeLessThan(1000);
    const a = result.packages.find((p) => p.name === 'pkg-a')!;
    const b = result.packages.find((p) => p.name === 'pkg-b')!;
    expect(a.paths).toEqual([['pkg-a'], ['pkg-a', 'pkg-b', 'pkg-a']]);
    expect(a.pathCountAtLeast).toBe(2);
    expect(b.paths).toEqual([['pkg-a', 'pkg-b']]);
    expect(b.pathCountAtLeast).toBe(1);
  });

  it('produces a clean empty result for a project with zero dependencies', () => {
    const result = parsePackageLock(readFixtureLock('package-lock-empty'), { productionOnly: true });
    expect(result.packages).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('exposes optional and peer flags per package, reachable via optionalDependencies/peerDependencies edges (not just dependencies)', () => {
    const contents = JSON.stringify({
      name: 'fixture-flags', version: '1.0.0', lockfileVersion: 3,
      packages: {
        '': { name: 'fixture-flags', version: '1.0.0', optionalDependencies: { 'opt-dep': '^1.0.0' } },
        'node_modules/opt-dep': { version: '1.0.0', optional: true, peerDependencies: { 'peer-dep': '^1.0.0' } },
        'node_modules/peer-dep': { version: '1.0.0', peer: true },
      },
    });
    const result = parsePackageLock(contents, { productionOnly: true });
    const opt = result.packages.find((p) => p.name === 'opt-dep')!;
    expect(opt).toBeDefined();
    expect(opt.optional).toBe(true);
    expect(opt.installPaths).toEqual(['node_modules/opt-dep']);

    // peer-dep is only reachable via opt-dep's own peerDependencies edge —
    // this is exactly the traversal path the bug fix must restore.
    const peer = result.packages.find((p) => p.name === 'peer-dep')!;
    expect(peer).toBeDefined();
    expect(peer.peer).toBe(true);
    expect(peer.paths).toEqual([['opt-dep', 'peer-dep']]);
  });
});
