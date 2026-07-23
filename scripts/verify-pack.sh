#!/usr/bin/env bash
# Verifies that `npm pack` + a real install actually ships a working CLI —
# specifically that data/ (SPDX license texts, category rules, conflict
# explanations) is present in the tarball and gets loaded from
# node_modules/licenseproof/data/ at runtime, not accidentally resolved via
# a dev-tree path. This is the exact regression M2 caught (data missing from
# package.json's "files" field) — this script re-proves the fix under a real
# packed install on every run, not just against the source tree.
#
# Milestone 6 additions: this script now ALSO verifies the published-artifact
# side of the license-key safety story (a meaningfully different check from
# tests/license/noPrivateKeyLeak.test.ts, which scans the git-tracked REPO
# tree — this script scans the actual packed tarball + a real post-install
# tree, which is what a real customer's `npm install licenseproof` produces):
#   - the tarball ships nothing under scripts/keygen/
#   - the installed tree contains no PEM private-key material
#   - the installed tree contains none of the internal planning docs
#   - the installed CLI's real gating behavior works: the free
#     sbom-cyclonedx format succeeds with no license key present, and a
#     gated format (pdf) refuses with exit code 3 and writes nothing.
#
# Usage: bash scripts/verify-pack.sh
# Exits non-zero on any verification failure.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "==> Building..."
npm run build

echo "==> Packing..."
npm pack --pack-destination /tmp

TARBALL=$(ls -t /tmp/licenseproof-*.tgz | head -1)
echo "==> Tarball: $TARBALL"

echo "==> Confirming data/ is present inside the tarball..."
if ! tar -tzf "$TARBALL" | grep -q '^package/data/manifest\.json$'; then
  echo "FAIL: data/manifest.json not found in tarball contents" >&2
  exit 1
fi

echo "==> Confirming the packed package.json still ships a real bin.licenseproof entry..."
# npm's package.json normalizer (@npmcli/package-json's secureAndUnixifyPath)
# silently rewrites bin values it considers non-canonical -- e.g. a leading
# "./" -- and prints a misleadingly-worded "invalid and removed" warning even
# though it just reassigns the corrected value rather than deleting the bin
# entry. That warning going unnoticed on a real publish is exactly the recur-
# rence this guards against: assert the PACKED metadata still resolves to a
# real file in the tarball, not just that `npm publish` exited 0.
PACKED_PKG_JSON=$(tar -xzOf "$TARBALL" package/package.json)
BIN_VALUE=$(node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    const pkg = JSON.parse(s);
    process.stdout.write((pkg.bin && pkg.bin.licenseproof) || "");
  });
' <<<"$PACKED_PKG_JSON")
if [ -z "$BIN_VALUE" ]; then
  echo "FAIL: packed package.json has no bin.licenseproof entry" >&2
  exit 1
fi
echo "==> Packed bin.licenseproof = $BIN_VALUE"
if ! tar -tzf "$TARBALL" | grep -qF "package/$BIN_VALUE"; then
  echo "FAIL: packed bin.licenseproof points at '$BIN_VALUE', which is not a file in the tarball" >&2
  exit 1
fi

echo "==> Confirming the tarball ships nothing under scripts/keygen/..."
if tar -tzf "$TARBALL" | grep -q '^package/scripts/keygen/'; then
  echo "FAIL: scripts/keygen/ found in the packed tarball" >&2
  tar -tzf "$TARBALL" | grep '^package/scripts/keygen/' >&2
  exit 1
fi

echo "==> Confirming the tarball ships nothing under scripts/ at all..."
if tar -tzf "$TARBALL" | grep -q '^package/scripts/'; then
  echo "FAIL: scripts/ found in the packed tarball" >&2
  tar -tzf "$TARBALL" | grep '^package/scripts/' >&2
  exit 1
fi

TEMP_INSTALL_DIR=$(mktemp -d)
echo "==> Installing into a clean temp dir: $TEMP_INSTALL_DIR"
(
  cd "$TEMP_INSTALL_DIR"
  npm init -y >/dev/null
  npm install "$TARBALL" >/dev/null
)

echo "==> Confirming node_modules/licenseproof/data/ exists on disk post-install..."
if [ ! -f "$TEMP_INSTALL_DIR/node_modules/licenseproof/data/manifest.json" ]; then
  echo "FAIL: node_modules/licenseproof/data/manifest.json missing after install" >&2
  exit 1
fi

echo "==> Confirming node_modules/.bin/licenseproof exists and is executable after a real install..."
# Proves the bin entry survived packing AND that npm actually wired the
# command on install, not just that the packed package.json contains the
# field. Bash's [ -x ] follows symlinks, so this checks the real target's
# executable bit, not just the symlink's own mode.
if [ ! -e "$TEMP_INSTALL_DIR/node_modules/.bin/licenseproof" ]; then
  echo "FAIL: node_modules/.bin/licenseproof does not exist after install" >&2
  exit 1
fi
if [ ! -x "$TEMP_INSTALL_DIR/node_modules/.bin/licenseproof" ]; then
  echo "FAIL: node_modules/.bin/licenseproof exists but is not executable" >&2
  exit 1
fi

INSTALLED_PKG_DIR="$TEMP_INSTALL_DIR/node_modules/licenseproof"

echo "==> Scanning the installed package tree for private-key material..."
# Same style of check as tests/license/noPrivateKeyLeak.test.ts's repo-tree
# scan, but applied to the REAL installed post-npm-install tree instead of the
# git-tracked working tree — a private key could in principle leak into the
# published artifact even if it never touches the repo (e.g. via a stray
# "files" glob), so this is a distinct assertion, not a duplicate.
#
# The marker string is built from two halves at runtime (never written
# contiguously below) so this script's OWN source text never contains the
# literal substring tests/license/noPrivateKeyLeak.test.ts scans for — this
# script is a git-tracked file too, and would otherwise trip its own guard.
PEM_MARKER_PART1="PRIVATE"
PEM_MARKER_PART2="KEY"
PEM_BLOCK_REGEX="-----BEGIN ([A-Z0-9]+ )*${PEM_MARKER_PART1} ${PEM_MARKER_PART2}-----"
GENERIC_MARKER="${PEM_MARKER_PART1} ${PEM_MARKER_PART2}"

if grep -rlE -- "$PEM_BLOCK_REGEX" "$INSTALLED_PKG_DIR" 2>/dev/null | grep -q .; then
  echo "FAIL: PEM private-key block found in the installed package:" >&2
  grep -rlE -- "$PEM_BLOCK_REGEX" "$INSTALLED_PKG_DIR" >&2
  exit 1
fi
if grep -rlF -- "$GENERIC_MARKER" "$INSTALLED_PKG_DIR" 2>/dev/null | grep -q .; then
  echo "FAIL: generic private-key marker found in the installed package:" >&2
  grep -rlF -- "$GENERIC_MARKER" "$INSTALLED_PKG_DIR" >&2
  exit 1
fi

echo "==> Confirming no internal planning docs shipped in the installed package..."
FORBIDDEN_DOCS=$(find "$INSTALLED_PKG_DIR" -type f \( \
  -name 'milestone*_brief.md' -o \
  -name 'licenseproof_v1_spec.md' -o \
  -name 'foundations_addendum.md' -o \
  -name '*_report.md' \
  \) 2>/dev/null || true)
if [ -n "$FORBIDDEN_DOCS" ]; then
  echo "FAIL: internal planning docs found in the installed package:" >&2
  echo "$FORBIDDEN_DOCS" >&2
  exit 1
fi

echo "==> Setting up a minimal scan target (a package.json with a real dependency, no node_modules or lockfile needed)..."
PACK_VERIFY_PROJECT=$(mktemp -d)
cat > "$PACK_VERIFY_PROJECT/package.json" <<'EOF'
{"name":"pack-verify-target","version":"1.0.0","dependencies":{"left-pad":"^1.3.0"}}
EOF

BIN="$TEMP_INSTALL_DIR/node_modules/.bin/licenseproof"

echo "==> Running the packed CLI (--format json) against the scan target..."
JSON_OUTPUT=$(node "$BIN" scan "$PACK_VERIFY_PROJECT" --format json)
JSON_EXIT=$?
echo "$JSON_OUTPUT"
echo "(exit code: $JSON_EXIT)"

echo "==> Checking for module-resolution errors..."
if echo "$JSON_OUTPUT" | grep -qiE 'cannot find module|enoent'; then
  echo "FAIL: output references a module-resolution error" >&2
  exit 1
fi

echo "==> Checking dataVersion is populated (proves data/ loaded from the packed location)..."
if ! echo "$JSON_OUTPUT" | grep -q '"dataVersion": *"[0-9]'; then
  echo "FAIL: dataVersion missing or not populated in JSON output" >&2
  exit 1
fi

echo "==> Confirming --help resolves through the installed bin (shebang + bin wiring intact)..."
node "$BIN" --help >/dev/null

# --- Milestone 6: real gating check against the packed + installed binary ---
#
# The installed CLI's key discovery reads `LICENSEPROOF_KEY` from the process
# environment and, failing that, `~/.config/licenseproof/license.key` from the
# REAL home directory (there's no CLI flag to inject a different key-file path
# — that injection point only exists in the unit-test surface). To guarantee a
# genuinely clean slate regardless of what's active on this machine, run the
# installed binary with LICENSEPROOF_KEY unset AND HOME pointed at a fresh,
# empty scratch directory — `os.homedir()` resolves from $HOME on POSIX, so
# this makes `~/.config/licenseproof/license.key` resolve to a path that is
# guaranteed not to exist, without ever touching the real
# ~/.config/licenseproof/ directory (which is left completely alone).
NOKEY_HOME=$(mktemp -d)
REPORT_OUT_DIR=$(mktemp -d)

echo "==> Verifying gating on the installed CLI with NO license key present anywhere (HOME=$NOKEY_HOME, LICENSEPROOF_KEY unset)..."

echo "==> licenseproof report --format sbom-cyclonedx (free format, no key) must succeed with a real written file..."
CYCLONE_OUT="$REPORT_OUT_DIR/sbom.cyclonedx.json"
set +e
CYCLONE_STDOUT=$(env -u LICENSEPROOF_KEY HOME="$NOKEY_HOME" node "$BIN" report "$PACK_VERIFY_PROJECT" --format sbom-cyclonedx --out "$CYCLONE_OUT" 2>&1)
CYCLONE_EXIT=$?
set -e
echo "$CYCLONE_STDOUT"
echo "(exit code: $CYCLONE_EXIT)"
if [ "$CYCLONE_EXIT" -ne 0 ]; then
  echo "FAIL: sbom-cyclonedx (free, no key) exited $CYCLONE_EXIT, expected 0" >&2
  exit 1
fi
if [ ! -s "$CYCLONE_OUT" ]; then
  echo "FAIL: sbom-cyclonedx output file missing or empty at $CYCLONE_OUT" >&2
  exit 1
fi
if ! grep -q '"bomFormat"' "$CYCLONE_OUT"; then
  echo "FAIL: sbom-cyclonedx output at $CYCLONE_OUT does not look like real CycloneDX content" >&2
  exit 1
fi

echo "==> licenseproof report --format pdf (gated format, no key) must refuse politely with exit 3 and write nothing..."
PDF_OUT="$REPORT_OUT_DIR/report.pdf"
set +e
PDF_STDOUT=$(env -u LICENSEPROOF_KEY HOME="$NOKEY_HOME" node "$BIN" report "$PACK_VERIFY_PROJECT" --format pdf --out "$PDF_OUT" 2>&1)
PDF_EXIT=$?
set -e
echo "$PDF_STDOUT"
echo "(exit code: $PDF_EXIT)"
if [ "$PDF_EXIT" -ne 3 ]; then
  echo "FAIL: pdf (gated, no key) exited $PDF_EXIT, expected 3" >&2
  exit 1
fi
if ! echo "$PDF_STDOUT" | grep -q '\$29'; then
  echo "FAIL: unlicensed refusal message is missing the individual price (\$29)" >&2
  exit 1
fi
if ! echo "$PDF_STDOUT" | grep -q '\$99'; then
  echo "FAIL: unlicensed refusal message is missing the agency price (\$99)" >&2
  exit 1
fi
if ! echo "$PDF_STDOUT" | grep -q 'licenseproof\.dev'; then
  echo "FAIL: unlicensed refusal message is missing licenseproof.dev" >&2
  exit 1
fi
if [ -e "$PDF_OUT" ]; then
  echo "FAIL: pdf output file was written despite no license key being present: $PDF_OUT" >&2
  exit 1
fi

echo "==> Cleaning up..."
rm -rf "$TEMP_INSTALL_DIR" "$PACK_VERIFY_PROJECT" "$TARBALL" "$NOKEY_HOME" "$REPORT_OUT_DIR"

echo "PASS: npm pack + install verification succeeded — data/ is packed, installed, and loaded correctly; keygen tooling and internal docs are excluded from the published artifact; real gating (free sbom-cyclonedx works, gated pdf refuses with exit 3) is confirmed against the installed CLI."
