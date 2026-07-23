import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parsePnpmLock } from '../../../src/ecosystems/npm/pnpmLockParser';

function readFixture(): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'pnpm-basic', 'pnpm-lock.yaml'), 'utf8');
}

describe('parsePnpmLock', () => {
  it('extracts direct and transitive packages with correct paths and counts', () => {
    const result = parsePnpmLock(readFixture(), { productionOnly: false });
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.direct).toBe(true);
    expect(express.paths).toEqual([['express']]);
    expect(express.pathCountAtLeast).toBe(1);

    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.direct).toBe(false);
    expect(bodyParser.paths).toEqual([['express', 'body-parser']]);
    expect(bodyParser.pathCountAtLeast).toBe(1);
  });

  it('marks a devDependency-only package as dev via reachability, not a lockfile field', () => {
    const result = parsePnpmLock(readFixture(), { productionOnly: false });
    const ts = result.packages.find((p) => p.name === 'typescript')!;
    expect(ts.dev).toBe(true);
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.dev).toBe(false);
  });

  it('excludes dev packages when productionOnly is true', () => {
    const result = parsePnpmLock(readFixture(), { productionOnly: true });
    expect(result.packages.find((p) => p.name === 'typescript')).toBeUndefined();
    expect(result.packages.find((p) => p.name === 'express')).toBeDefined();
  });

  it('surfaces a package reachable via optionalDependencies (not dependencies), with its optional flag', () => {
    const result = parsePnpmLock(readFixture(), { productionOnly: true });
    const fsevents = result.packages.find((p) => p.name === 'fsevents')!;
    expect(fsevents).toBeDefined();
    expect(fsevents.optional).toBe(true);
    expect(fsevents.direct).toBe(true);
  });

  it("surfaces a package reachable via a non-root snapshot's optionalDependencies", () => {
    const result = parsePnpmLock(readFixture(), { productionOnly: false });
    const nativeAddon = result.packages.find((p) => p.name === 'native-addon')!;
    expect(nativeAddon).toBeDefined();
    expect(nativeAddon.optional).toBe(true);
    expect(nativeAddon.direct).toBe(false);
    expect(nativeAddon.paths).toEqual([['express', 'build-tool', 'native-addon']]);
  });
});

function readRealLayoutFixture(): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'pnpm-real-layout', 'pnpm-lock.yaml'), 'utf8');
}

describe('parsePnpmLock — real .pnpm layout candidates', () => {
  it('computes the top-level symlink path first, then the .pnpm content-dir path as fallback', () => {
    const result = parsePnpmLock(readRealLayoutFixture(), { productionOnly: true });
    const express = result.packages.find((p) => p.name === 'express')!;
    expect(express.installPaths).toEqual(['node_modules/express', 'node_modules/.pnpm/express@4.18.2/node_modules/express']);

    const bodyParser = result.packages.find((p) => p.name === 'body-parser')!;
    expect(bodyParser.installPaths).toEqual(['node_modules/body-parser', 'node_modules/.pnpm/body-parser@1.20.2/node_modules/body-parser']);
  });
});

function readPeerSuffixFixture(): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'pnpm-peer-suffix', 'pnpm-lock.yaml'), 'utf8');
}

// The snapshot key/store-dir pair here (react-redux@8.1.3 with @types/react + react +
// redux peers) is copied verbatim from a real `pnpm install` against the real npm
// registry (pnpm 9.15.9) — see the comment on `pnpmStoreDirName` in
// src/ecosystems/npm/pnpmLockParser.ts for the full verification note.
describe('parsePnpmLock — peer-dependency-suffixed snapshot keys', () => {
  it('splits name/version correctly for a peer-suffixed key, ignoring the "@" characters inside the peer suffix', () => {
    const result = parsePnpmLock(readPeerSuffixFixture(), { productionOnly: true });
    const reactRedux = result.packages.find((p) => p.name === 'react-redux')!;
    expect(reactRedux).toBeDefined();
    expect(reactRedux.name).toBe('react-redux');
    expect(reactRedux.version).toBe('8.1.3');
    expect(reactRedux.direct).toBe(true);
  });

  it('encodes the peer suffix into the .pnpm content-dir installPaths candidate, with scoped-peer "/" escaped to "+"', () => {
    const result = parsePnpmLock(readPeerSuffixFixture(), { productionOnly: true });
    const reactRedux = result.packages.find((p) => p.name === 'react-redux')!;
    expect(reactRedux.installPaths).toEqual([
      'node_modules/react-redux',
      'node_modules/.pnpm/react-redux@8.1.3_@types+react@18.3.31_react@18.2.0_redux@4.2.1/node_modules/react-redux',
    ]);
  });

  it('still resolves the plain (non-peer-suffixed) react/redux packages correctly alongside the peer-suffixed one', () => {
    const result = parsePnpmLock(readPeerSuffixFixture(), { productionOnly: true });
    const react = result.packages.find((p) => p.name === 'react')!;
    expect(react.version).toBe('18.2.0');
    const redux = result.packages.find((p) => p.name === 'redux')!;
    expect(redux.version).toBe('4.2.1');
  });
});

function readMixedCaseFixture(): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'pnpm-mixed-case', 'pnpm-lock.yaml'), 'utf8');
}

// Real pnpm 9.15.9 triggers the MD5+base32 hash fallback on EITHER of two
// independent conditions: the encoded filename exceeds 120 chars (already covered
// by the peer-suffix fixture above), OR the encoded filename differs from its own
// lowercased form and doesn't start with "file+" (the mixed-case trigger). A
// dedicated review of commit 0749bd4 found the second trigger was never
// implemented — this snapshot key ("some-pkg@1.0.0-RC.1", uppercase letters in a
// prerelease tag) is nowhere near the length trigger, isolating the gap. The
// expected hash below (base32-encoded MD5 of the literal string
// "some-pkg@1.0.0-RC.1") was computed independently via the same, already-verified
// base32(MD5) algorithm — this test only proves the TRIGGER condition now fires,
// not a re-verification of the hash encoding itself.
describe('parsePnpmLock — mixed-case snapshot key hash-fallback trigger', () => {
  it('hashes the .pnpm store dir name for a mixed-case, non-file-protocol snapshot key even when far under the 120-char length trigger', () => {
    const result = parsePnpmLock(readMixedCaseFixture(), { productionOnly: true });
    const somePkg = result.packages.find((p) => p.name === 'some-pkg')!;
    expect(somePkg).toBeDefined();
    expect(somePkg.version).toBe('1.0.0-RC.1');
    expect(somePkg.installPaths).toEqual([
      'node_modules/some-pkg',
      'node_modules/.pnpm/some-pkg@1.0.0-RC.1_4r6sfaxarsjeukpf34tglzr54u/node_modules/some-pkg',
    ]);
  });
});
