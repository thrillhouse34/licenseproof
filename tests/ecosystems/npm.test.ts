import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { npmEcosystem } from '../../src/ecosystems/npm';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');

describe('npmEcosystem.detect', () => {
  it('detects an npm project via package.json presence', () => {
    expect(npmEcosystem.detect(path.join(FIXTURES, 'package-lock-v3-basic'))).toBe(true);
  });
  it('does not detect a directory without package.json', () => {
    expect(npmEcosystem.detect(os_tmpdir())).toBe(false);
  });
});

function os_tmpdir(): string {
  return require('os').tmpdir();
}

describe('npmEcosystem.scan — lockfile priority and basic wiring', () => {
  it('picks package-lock.json when present and reports lockfile kind', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-v3-basic'), { productionOnly: true });
    expect(result.lockfile).toBe('package-lock');
    expect(result.projectName).toBe('fixture-package-lock-v3');
    expect(result.packages.some((p) => p.name === 'express')).toBe(true);
    expect(result.ecosystems).toEqual(['npm']);
  });

  it('exposes the root project\'s own declared license as projectLicenseRaw', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-v3-basic'), { productionOnly: true });
    expect(result.projectLicenseRaw).toBe('MIT');
  });

  it('picks pnpm-lock.yaml when no package-lock.json is present', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'pnpm-basic'), { productionOnly: false });
    expect(result.lockfile).toBe('pnpm');
    expect(result.packages.some((p) => p.name === 'express')).toBe(true);
  });

  it('picks yarn classic when only yarn.lock (v1 text) is present', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'yarn-classic-basic'), { productionOnly: false });
    expect(result.lockfile).toBe('yarn-classic');
  });

  it('picks yarn berry when only yarn.lock (YAML/__metadata) is present', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'yarn-berry-basic'), { productionOnly: false });
    expect(result.lockfile).toBe('yarn-berry');
  });
});

describe('npmEcosystem.scan — disk-based optional dependency filtering', () => {
  it('excludes an optional dependency present in the lockfile but absent from node_modules, and warns with a count', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-optional-not-installed'), { productionOnly: true });
    expect(result.packages.find((p) => p.name === 'fsevents')).toBeUndefined();
    expect(result.packages.find((p) => p.name === 'left-pad')).toBeDefined();
    expect(result.warnings.some((w) => w.includes('optional') && w.includes('1'))).toBe(true);
  });

  it('populates diskPath for a package confirmed present on disk, and installPath as its declared candidate', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-optional-not-installed'), { productionOnly: true });
    const leftPad = result.packages.find((p) => p.name === 'left-pad')!;
    expect(leftPad.installPath).toBe('node_modules/left-pad');
    expect(leftPad.diskPath).toBe('node_modules/left-pad');
  });
});

describe('npmEcosystem.scan — monorepo/workspaces', () => {
  it('warns and does not attempt to traverse workspace member packages', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-monorepo'), { productionOnly: true });
    expect(result.warnings.some((w) => w.toLowerCase().includes('workspaces not supported'))).toBe(true);
    expect(result.packages.some((p) => p.name === 'left-pad')).toBe(true); // root's own deps still scanned
  });
});

describe('npmEcosystem.scan — no lockfile fallback', () => {
  it('falls back to declared-deps-only with a loud warning when no lockfile and no node_modules exist', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'no-lockfile-declared-only'), { productionOnly: true });
    expect(result.lockfile).toBe('none');
    expect(result.warnings.some((w) => w.toLowerCase().includes('no lockfile') || w.toLowerCase().includes('no package-lock'))).toBe(true);
    expect(result.packages.map((p) => p.name)).toContain('some-declared-dep');
  });

  it('walks node_modules directly when no lockfile exists but node_modules is present', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'no-lockfile-node-modules-walk'), { productionOnly: true });
    expect(result.lockfile).toBe('none');
    expect(result.warnings.some((w) => w.toLowerCase().includes('walked node_modules'))).toBe(true);

    const leftPad = result.packages.find((p) => p.name === 'left-pad')!;
    expect(leftPad).toBeDefined();
    expect(leftPad.version).toBe('1.3.0');
    expect(leftPad.direct).toBe(true);
    expect(leftPad.licenseRaw).toBe('MIT');

    const scoped = result.packages.find((p) => p.name === '@myorg/util')!;
    expect(scoped).toBeDefined();
    expect(scoped.version).toBe('2.0.0');
    expect(scoped.direct).toBe(false); // not in package.json's declared dependencies
  });
});

describe('npmEcosystem.scan — empty project', () => {
  it('produces a clean report with zero packages, no crash', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'package-lock-empty'), { productionOnly: true });
    expect(result.packages).toEqual([]);
  });
});

describe('npmEcosystem.scan — pnpm real .pnpm layout diskPath resolution', () => {
  it('resolves diskPath via the top-level symlink path when present', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'pnpm-real-layout'), { productionOnly: true });
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.installPath).toBe('node_modules/express'); // declared primary candidate
    expect(express.diskPath).toBe('node_modules/express'); // symlink-equivalent path existed, used first
  });

  it('falls back to the .pnpm content-dir path when the top-level symlink is absent (transitive-only package)', async () => {
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'pnpm-real-layout'), { productionOnly: true });
    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.installPath).toBe('node_modules/body-parser'); // still the declared primary candidate...
    expect(bodyParser.diskPath).toBe('node_modules/.pnpm/body-parser@1.20.2/node_modules/body-parser'); // ...but the REAL location is the fallback
  });
});

describe('npmEcosystem.scan — pnpm peer-dependency-suffixed snapshot key diskPath resolution', () => {
  it('resolves diskPath through the peer-suffix-encoded .pnpm content-dir candidate end-to-end', async () => {
    // fixtures/pnpm-peer-suffix deliberately omits the top-level node_modules/react-redux
    // symlink-equivalent directory, so this only passes if pnpmStoreDirName correctly
    // encodes the "(@types/react@18.3.31)(react@18.2.0)(redux@4.2.1)" peer suffix into
    // the real on-disk directory name — a wrong encoding would leave diskPath undefined,
    // not silently produce a wrong-but-present path.
    const result = await npmEcosystem.scan(path.join(FIXTURES, 'pnpm-peer-suffix'), { productionOnly: true });
    const reactRedux = result.packages.find((p) => p.name === 'react-redux')!;
    expect(reactRedux).toBeDefined();
    expect(reactRedux.version).toBe('8.1.3');
    expect(reactRedux.installPath).toBe('node_modules/react-redux');
    expect(reactRedux.diskPath).toBe(
      'node_modules/.pnpm/react-redux@8.1.3_@types+react@18.3.31_react@18.2.0_redux@4.2.1/node_modules/react-redux'
    );

    // The plain (non-peer-suffixed) direct deps resolve normally via their top-level dirs.
    const react = result.packages.find((p) => p.name === 'react')!;
    expect(react.diskPath).toBe('node_modules/react');
    const redux = result.packages.find((p) => p.name === 'redux')!;
    expect(redux.diskPath).toBe('node_modules/redux');
  });
});

describe('npmEcosystem.scan — huge tree performance', () => {
  it('parses a 3000+ package chain in under 10 seconds', async () => {
    const packagesMap: Record<string, any> = {
      '': { name: 'fixture-huge', version: '1.0.0', dependencies: { 'pkg-0': '^1.0.0' } },
    };
    const COUNT = 3000;
    for (let i = 0; i < COUNT; i++) {
      const deps = i < COUNT - 1 ? { [`pkg-${i + 1}`]: '^1.0.0' } : {};
      packagesMap[`node_modules/pkg-${i}`] = { version: '1.0.0', license: 'MIT', dependencies: deps };
    }
    const lockfileContents = JSON.stringify({ name: 'fixture-huge', version: '1.0.0', lockfileVersion: 3, packages: packagesMap });

    const { parsePackageLock } = await import('../../src/ecosystems/npm/packageLockParser');
    const start = Date.now();
    const result = parsePackageLock(lockfileContents, { productionOnly: true });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(10000);
    expect(result.packages).toHaveLength(COUNT);
  });
});
