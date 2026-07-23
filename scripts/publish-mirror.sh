#!/usr/bin/env bash
#
# publish-mirror.sh — build a clean, PUBLIC-ready single-commit git repo at
# ../licenseproof-public from this private development repo.
#
# What it does:
#   - Copies every git-tracked file EXCEPT internal working documents and the
#     private key-generation tooling (see EXCLUDE_RE below), plus the built
#     dist/ tree (gitignored in this dev repo, but a required part of the
#     runnable public package: bin -> dist/cli/index.js).
#   - Initializes the target as a FRESH single-commit git repo. This is the
#     public mirror's own origin story, NOT a copy of this repo's private
#     development history.
#
# What it deliberately does NOT do (these are manual launch steps for Mark):
#   - Create a GitHub repo, add a git remote, or push anything anywhere.
#
# Idempotent: each run fully wipes and regenerates the target directory, so
# running it twice in a row produces the same clean result — never an
# accumulation of stale files from a previous run.
#
# It never reads from, writes to, or otherwise touches the sibling
# ../licenseproof-private directory (which holds the real signing key).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="$(cd .. && pwd)/licenseproof-public"

# --- Safety rails -----------------------------------------------------------
# Never let the target resolve to the private-key directory or to this repo.
case "$TARGET" in
  *licenseproof-private*)
    echo "refusing: target path overlaps the private key directory ($TARGET)" >&2
    exit 1
    ;;
esac
if [ "$TARGET" = "$REPO_ROOT" ]; then
  echo "refusing: target path is the repo itself ($TARGET)" >&2
  exit 1
fi

# --- Build ------------------------------------------------------------------
echo "==> Building dist/ (npm run build)"
npm run build >/dev/null

# --- Regenerate a clean tree ------------------------------------------------
echo "==> Regenerating clean public tree at: $TARGET"
# This Mac's ~/Documents is iCloud-synced, and a previous run's target tree can
# pick up permission-restricted iCloud conflict-copy artifacts (e.g. a
# ".git 3" or "fixtures 3" directory dropped in read-only). A plain `rm -rf`
# can fail ("Directory not empty") against those and, under `set -e`, abort
# mid-wipe — leaving a broken half-regenerated mirror behind. Restore write
# permissions recursively first, and retry the removal once more before
# giving up, so re-running this script stays truly idempotent even when the
# previous target has stuck sync-conflict leftovers.
if [ -e "$TARGET" ]; then
  chmod -R u+w "$TARGET" 2>/dev/null || true
  rm -rf "$TARGET" 2>/dev/null || true
  if [ -e "$TARGET" ]; then
    chmod -R u+w "$TARGET" 2>/dev/null || true
    rm -rf "$TARGET"
  fi
fi
mkdir -p "$TARGET"

# Files to EXCLUDE from the public mirror, matched (anchored, full-path) against
# each git-tracked path with POSIX ERE:
#   milestone*_brief.md        — internal milestone briefs (business/planning)
#   licenseproof_v1_spec.md    — internal product spec
#   foundations_addendum.md    — internal binding-decisions doc
#   *_report.md                — internal review/completion reports (none tracked
#                                today; guard for the future)
#   scripts/keygen/**          — PRIVATE key-generation tooling. NEVER shipped.
#   docs/plans/**              — internal implementation-planning documents
#   site/**                    — the licenseproof.dev marketing site. Deployed
#                                by drag-upload to Cloudflare Pages, not part of
#                                the npm package or the tool's source-available
#                                surface — keep this mirror scoped to the CLI.
#   .superpowers/**            — subagent-driven-development ledger/tooling
#                                (internal process tooling, not the product;
#                                not git-tracked today, guard for the future)
EXCLUDE_RE='^(milestone[^/]*_brief\.md|licenseproof_v1_spec\.md|foundations_addendum\.md|.*_report\.md|scripts/keygen/.*|docs/plans/.*|site/.*|\.superpowers/.*)$'

# Copy every git-tracked file except the excluded ones, preserving structure.
copied=0
excluded=0
while IFS= read -r -d '' f; do
  if printf '%s' "$f" | grep -Eq "$EXCLUDE_RE"; then
    excluded=$((excluded + 1))
    continue
  fi
  mkdir -p "$TARGET/$(dirname "$f")"
  cp -p "$f" "$TARGET/$f"
  copied=$((copied + 1))
done < <(git ls-files -z)

# dist/ is gitignored in this dev repo but ships in the public package.
if [ -d dist ]; then
  cp -Rp dist "$TARGET/dist"
fi

echo "==> Copied $copied tracked files, excluded $excluded internal files, plus dist/"

# --- Fresh single-commit git repo -------------------------------------------
cd "$TARGET"
rm -rf .git
git init -q
git add -A
# dist/ is listed in the copied .gitignore; force it in — the public repo ships
# a ready-to-run build.
git add -f dist
git commit -q -m "licenseproof — know every license in your dependency tree"

echo "==> Done. Clean single-commit public mirror at: $TARGET"
git log --oneline
