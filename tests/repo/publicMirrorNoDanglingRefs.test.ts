import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from '../../src/paths';

// Ported from ceproof-private's tests/repo/publicMirrorNoDanglingRefs.test.ts,
// after an audit found the same latent gap could exist here: README.md and
// README-DEV.md are DELIBERATELY kept in the public mirror (see
// scripts/publish-mirror.sh's own EXCLUDE_RE), but nothing previously checked
// whether either one references, by exact filename, one of the internal docs
// that same script excludes. Same species of bug as ceproof's real one this
// guard caught (README-DEV.md named `licenseproof_v1_spec.md` and
// `foundations_addendum.md` outright, and separately pointed a reader at
// `ceproof-private/foundations_addendum.md` — a file in a DIFFERENT private
// repo a public licenseproof reader could never reach either way) — a pointer
// to something the reader structurally cannot reach.
//
// This test doesn't re-check the *content* of what's kept; it checks a
// narrower, purely structural property: no file the mirror keeps may
// reference, by exact filename, a file the SAME mirror run would have
// excluded. That's a real property of scripts/publish-mirror.sh's actual
// EXCLUDE_RE — read from the script itself below, not copied by hand, so this
// test can't silently drift out of sync with the real exclusion rule.
//
// Scoped to the file-level excludes only (milestone*_brief.md,
// licenseproof_v1_spec.md, foundations_addendum.md, *_report.md — every
// excluded path with no "/", i.e. a single top-level file whose exact name is
// a meaningful thing to reference by name in prose), not the directory-tree
// excludes (scripts/keygen/**, docs/plans/**, site/**, .superpowers/**). A
// source comment stating that private tooling lives under scripts/keygen/ is
// a true architectural fact, not a broken "go read this" pointer the way
// naming one specific missing .md file is.
//
// Further scoped to *.md files among the kept set, not every kept file
// (which would include all of src/, scripts/, tests/) — matching ceproof's
// original scoping decision: README.md and README-DEV.md are prose
// documentation whose whole job is to be a reader's map of "where to look
// next," so a dangling filename there is misleading in a way a source-code
// doc-comment aimed at a maintainer isn't.

const MIRROR_SCRIPT = path.join(REPO_ROOT, 'scripts', 'publish-mirror.sh');
const THIS_FILE = path.resolve(__filename);

const BINARY_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.tgz', '.tar',
  '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mov',
]);

function readExcludeRegex(): RegExp {
  const scriptSource = fs.readFileSync(MIRROR_SCRIPT, 'utf8');
  const m = scriptSource.match(/^EXCLUDE_RE='(.+)'$/m);
  if (!m) {
    throw new Error(`Could not find EXCLUDE_RE in ${MIRROR_SCRIPT} — has the script's shape changed?`);
  }
  // The script's POSIX-ERE pattern is plain enough (anchors, alternation,
  // character classes, escaped dots, .*) to also be a valid JS RegExp
  // source unchanged.
  return new RegExp(m[1]);
}

function listTrackedFiles(): string[] {
  const raw = execSync('git ls-files -z', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return raw.split('\0').filter((rel) => rel.length > 0);
}

describe('public-mirror consistency: no kept file dangles a reference to an excluded file', () => {
  const excludeRe = readExcludeRegex();
  const tracked = listTrackedFiles();
  const excluded = tracked.filter((rel) => excludeRe.test(rel));
  const kept = tracked.filter((rel) => !excludeRe.test(rel));

  // The specific file-level excludes this test cares about: excluded paths
  // with no "/" component (a single top-level file, not a directory-tree
  // exclude — see the file-header comment above for why directory excludes
  // are out of scope here).
  const excludedFileNames = excluded.filter((rel) => !rel.includes('/'));

  it('sanity: EXCLUDE_RE parsed from the real script actually excludes known internal docs', () => {
    // If this list is ever empty, either the doc-naming convention changed or
    // the regex parse above broke silently — either way, the rest of this
    // file's checks would be vacuous, so fail loudly here first.
    expect(excludedFileNames.length).toBeGreaterThan(0);
    expect(excludedFileNames).toEqual(
      expect.arrayContaining(['milestone1_brief.md', 'licenseproof_v1_spec.md', 'foundations_addendum.md']),
    );
  });

  it('no *.md file kept in the public mirror references an excluded file by name', () => {
    const offenders: string[] = [];
    for (const rel of kept) {
      const abs = path.join(REPO_ROOT, rel);
      if (path.resolve(abs) === THIS_FILE) continue; // this file's own doc comment names examples
      if (path.resolve(abs) === MIRROR_SCRIPT) continue; // the exclusion rule's own source of truth
      const ext = path.extname(rel).toLowerCase();
      if (ext !== '.md') continue; // see the file-header comment: prose docs only, not source comments
      if (BINARY_EXT.has(ext)) continue;
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue; // e.g. a broken symlink — not this test's concern
      }
      for (const excludedName of excludedFileNames) {
        if (content.includes(excludedName)) {
          offenders.push(`${rel} references excluded file "${excludedName}"`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
