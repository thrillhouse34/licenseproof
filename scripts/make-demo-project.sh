#!/usr/bin/env bash
set -euo pipefail

# scripts/make-demo-project.sh
#
# Builds a realistic, best-case demo project used to generate the flagship
# marketing sample under assets/samples/ (Milestone 6, Task 4). Unlike every
# other fixture in this repo -- which deliberately exercises worst-case/edge-
# case behavior for testing -- this one is built to look genuinely good: real
# `npm install` + real `uv sync` on both sides, so resolution rates are high
# and honest, both ecosystems are well represented, and the one real GPL
# conflict (ffmpeg-static, same package already used in
# fixtures/report-demo-conflict/) shows up with its full explanation.
#
# The project is a single flat directory containing BOTH package.json (npm
# side) and pyproject.toml/uv.lock (pypi side) at the same root, because
# licenseproof's ecosystem detection looks for both ecosystems' markers at the
# exact same project path (see src/report/reportData.ts buildReportData).
#
# Usage:
#   scripts/make-demo-project.sh [target-dir]
#
# If target-dir is omitted, a fresh directory is created under mktemp -d.
# If target-dir is given, it is wiped and rebuilt from scratch -- safe to
# re-run any time the demo needs regenerating.
#
# The final project directory path is printed as the LAST line of stdout, so
# a caller can capture it with: DIR=$(scripts/make-demo-project.sh | tail -1)

TARGET_DIR="${1:-}"

if [[ -z "$TARGET_DIR" ]]; then
  TARGET_DIR="$(mktemp -d -t licenseproof-demo)"
else
  rm -rf "$TARGET_DIR"
  mkdir -p "$TARGET_DIR"
fi

echo "licenseproof demo project -> $TARGET_DIR" >&2

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' is not installed or not on PATH. Install it first (e.g. 'brew install uv')." >&2
  exit 1
fi

# --- npm side -------------------------------------------------------------
# A realistic proprietary "video platform" product depending on a healthy
# spread of real, well-known, permissively-licensed npm packages, PLUS
# ffmpeg-static (GPL-3.0-or-later) as the real conflict-triggering package --
# the same real package already used in fixtures/report-demo-conflict/ from
# Milestone 5. "UNLICENSED" is a real proprietary-style project license (see
# fixtures/report-demo-conflict/package.json for the identical pattern) --
# it resolves to conservative "proprietary" conflict-checking mode, which is
# exactly what triggers the strong-copyleft-in-proprietary CONFLICT against
# ffmpeg-static.
cat > "$TARGET_DIR/package.json" <<'EOF'
{
  "name": "acme-video-platform",
  "version": "1.0.0",
  "private": true,
  "license": "UNLICENSED",
  "description": "Internal video ingest, transcode, and delivery platform.",
  "dependencies": {
    "express": "^4.21.0",
    "ffmpeg-static": "^5.3.0",
    "lodash": "^4.17.21",
    "dayjs": "^1.11.13",
    "zod": "^3.23.8",
    "chalk": "^5.3.0",
    "uuid": "^9.0.1",
    "axios": "^1.7.7",
    "cors": "^2.8.5"
  }
}
EOF

echo "-- npm install (real, in $TARGET_DIR) --" >&2
(cd "$TARGET_DIR" && npm install --no-audit --no-fund)

# --- pypi side --------------------------------------------------------------
# A small, realistic uv-managed Python project at the SAME project root as
# package.json (required -- see comment above). `[tool.uv] package = false`
# treats this as a plain application (no build backend / no importable
# top-level module needed) so `uv sync` just resolves + installs the real
# dependencies into a real .venv. This is the key difference from the M4/M5
# dogfood samples, which had no .venv at all and showed a wall of UNKNOWN --
# a real .venv here means real .dist-info/METADATA files and a genuinely high
# resolution rate.
cat > "$TARGET_DIR/pyproject.toml" <<'EOF'
[project]
name = "acme-video-worker"
version = "1.0.0"
description = "Background transcode and notification worker for acme-video-platform."
requires-python = ">=3.11"
dependencies = [
    "requests>=2.32.0",
    "click>=8.1.7",
    "pydantic>=2.9.0",
    "rich>=13.8.0",
    "python-dotenv>=1.0.1",
]

[tool.uv]
package = false
EOF

echo "-- uv sync (real, in $TARGET_DIR) --" >&2
(cd "$TARGET_DIR" && uv sync)

echo "Demo project ready at: $TARGET_DIR" >&2
echo "  npm:  package.json + node_modules/ + package-lock.json" >&2
echo "  pypi: pyproject.toml + uv.lock + .venv/" >&2

# Last line of stdout is the path itself, so `DIR=$(script | tail -1)` works.
echo "$TARGET_DIR"
