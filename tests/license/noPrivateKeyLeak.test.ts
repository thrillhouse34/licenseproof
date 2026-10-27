import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../../src/paths';

// Security regression guard for Milestone 6's signing infrastructure.
//
// The real private signing key is managed entirely OUTSIDE this repo, in
// separate out-of-band storage (its real location is deliberately not
// recorded here — see scripts/keygen/generateSigningKey.mjs's header), so it
// structurally cannot be committed. These tests are defense-in-depth: they
// fail loudly if a private key ever ends up inside the repo's COMMITTED
// content by accident (a mis-copied file, a paste into a doc), AND if the
// never-shipped keygen tooling under scripts/keygen/ ever leaks into the
// published npm package.
//
// Scope is git-tracked files only (via `git ls-files`), not a raw filesystem
// walk. This answers the question that actually matters — "could a private key
// ever be committed/pushed?" — rather than "does anything on disk anywhere
// happen to contain this substring." A raw walk also picks up gitignored local
// scratch/review content (e.g. .superpowers/sdd/*.diff, which legitimately
// quotes "PRIVATE KEY" while reviewing this exact feature) and false-fails on
// files that could never actually leak.

const THIS_FILE = path.resolve(__filename);

const BINARY_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.tgz', '.tar',
  '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mov',
]);

// The full, real set of files git tracks in this repo — exactly what could
// end up committed and pushed. NUL-delimited (`-z`) so filenames with spaces
// or unusual characters split correctly.
function listTrackedFiles(): string[] {
  const raw = execSync('git ls-files -z', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return raw
    .split('\0')
    .filter((rel) => rel.length > 0)
    .map((rel) => path.resolve(REPO_ROOT, rel));
}

// A COMPLETE PEM private-key block (any variant), header through footer. Prose
// that merely mentions the header string (e.g. the M6 plan doc) does not match,
// because a real leak always has both the BEGIN header and the END footer with
// key material between them.
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/;

// Defense-in-depth: the uppercase PEM marker substring should never appear in
// source/data/config. It legitimately appears in Markdown docs that DISCUSS the
// key format (the plan, briefs), so the generic substring check excludes .md;
// the full-block regex above still covers a real key pasted into any file type,
// including Markdown.
const GENERIC_MARKER = 'PRIVATE KEY';

describe('no private key material leaks into the repo tree', () => {
  const files: string[] = listTrackedFiles();

  it('lists a non-trivial number of tracked files (sanity: git ls-files actually ran)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no file contains a complete PEM private-key block', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (path.resolve(file) === THIS_FILE) continue; // this test defines the pattern
      if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (PRIVATE_KEY_BLOCK.test(content)) offenders.push(path.relative(REPO_ROOT, file));
    }
    expect(offenders, `PEM private-key block found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no non-Markdown file contains the uppercase "PRIVATE KEY" marker', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (path.resolve(file) === THIS_FILE) continue;
      const ext = path.extname(file).toLowerCase();
      if (ext === '.md') continue; // docs legitimately discuss the format
      if (BINARY_EXT.has(ext)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(GENERIC_MARKER)) offenders.push(path.relative(REPO_ROOT, file));
    }
    expect(offenders, `Uppercase "PRIVATE KEY" marker found in: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('npm pack never ships the private keygen tooling', () => {
  // Inspect what npm WOULD actually pack (the real "files" allowlist resolution),
  // not just the literal package.json "files" array — this catches a future
  // accidental broadening (e.g. adding a "scripts/**" glob) that a string check
  // of the array would miss.
  const raw = execSync('npm pack --dry-run --json', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  const packedPaths: string[] = parsed[0].files.map((f: { path: string }) => f.path);

  it('packs a real file list (sanity: dist/ or data/ present)', () => {
    expect(packedPaths.length).toBeGreaterThan(0);
  });

  it('packs nothing under scripts/keygen/', () => {
    const leaked = packedPaths.filter((p) => p.startsWith('scripts/keygen/'));
    expect(leaked, `keygen tooling leaked into the package: ${leaked.join(', ')}`).toEqual([]);
  });

  it('packs nothing under scripts/ at all', () => {
    const leaked = packedPaths.filter((p) => p.startsWith('scripts/'));
    expect(leaked, `scripts/ leaked into the package: ${leaked.join(', ')}`).toEqual([]);
  });
});
