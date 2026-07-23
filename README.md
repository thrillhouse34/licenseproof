# licenseproof

![npm version](https://img.shields.io/npm/v/licenseproof) ![license: Elastic-2.0](https://img.shields.io/badge/license-Elastic--2.0-blue)

Know every license in your dependency tree — before your customer's lawyer asks.

![licenseproof scanning a project's dependencies and flagging a GPL license conflict in the terminal](assets/demo.gif)

`licenseproof` scans your project's dependency tree — Node (npm, pnpm, or Yarn) and/or Python (uv, Poetry, pip) — resolves each package's license against vendored SPDX data, and flags anything that could conflict with your project's own license — strong-copyleft (GPL/AGPL), non-commercial-only terms (CC-BY-NC, BUSL, SSPL), or licenses it couldn't confidently identify. A project with both a `package.json` and a `pyproject.toml`/`requirements.txt` side by side is scanned as one combined report. No network calls, no accounts, no API keys — everything it needs ships in the package. Learn more at [licenseproof.dev](https://licenseproof.dev).

## 60-second quickstart

```bash
npx licenseproof scan
```

That's it — run it from your project root (anywhere `package.json` and/or `pyproject.toml`/`requirements.txt`/`poetry.lock`/`uv.lock` lives) and it scans your production dependencies by default. Pass a path to scan a different project:

```bash
npx licenseproof scan ./some-other-project
```

Add `--format json` if you want machine-readable output for CI, or `--fail-on never` if you just want to see the report without affecting your build's exit code.

## Real output example

Run against this repo's own `resolve-08-conflict-matrix` test fixture (a project with a permissive package, a strong-copyleft package, and a non-commercial-only package):

```
$ licenseproof scan fixtures/resolve-08-conflict-matrix
LicenseProof scan: fixture-resolve-08-conflict-matrix
Project license: unspecified
  No license declared or recognized for this project (unspecified) — assuming
  the strictest, proprietary-equivalent conflict rules.
  Pass --project-license <SPDX id> to override this assumption.
3 packages scanned — 2 conflict, 0 agpl-noted, 0 review, 0 unknown
licenseproof 0.3.1 · data 2026.07.21.2 · scanned 2026-07-22T08:37:20.388Z

By category:
  permissive: 1
  strong-copyleft: 1
  noncommercial: 1

CONFLICT (2):
  noncommercial-pkg@1.0.0 — CC-BY-NC-4.0
    via noncommercial-pkg
    This package's license restricts commercial use or requires special
    commercial terms (e.g. BUSL, SSPL, CC-BY-NC). Flagged as CONFLICT for any
    commercial project.
  strong-copyleft-pkg@1.0.0 — GPL-3.0-only
    via strong-copyleft-pkg
    This package is under a strong-copyleft license (e.g. GPL/AGPL).
    Distributing it as part of a closed-source product can require releasing
    your own source code under the same terms. Flagged as CONFLICT for a
    proprietary project.

$ echo $?
1
```

(Exit code `1` because a `CONFLICT`-level package was found and `--fail-on conflict` is the default — see the flags table below.)

## PyPI / Python support

licenseproof detects a Python project by the presence of any of these files in the scan directory, and picks ONE tier — the most specific/accurate one present — using this exact precedence order:

```
uv.lock  >  poetry.lock  >  requirements.txt (pinned)  >  pyproject.toml (declared-only)
```

- **`uv.lock`** — the full resolved tree (production + every dev group), parsed directly; no `pyproject.toml` cross-reference needed.
- **`poetry.lock`** — the full resolved tree, cross-referenced against `pyproject.toml`'s `[tool.poetry.dependencies]` / `[tool.poetry.group.*]` to classify production vs. dev.
- **`requirements.txt`** — only lines pinned exactly as `name==version` are resolved; git/URL/local-path installs and unpinned ranges are reported as warnings, never silently dropped. `requirements.txt` carries no transitive dependency information, so every resolved package is reported as a direct, top-level dependency (a disclosed limitation, not a bug).
- **`pyproject.toml` (declared-only fallback)** — used only when no lockfile of any kind is present. Reports the project's declared top-level dependencies (`[project.dependencies]`/`[project.optional-dependencies]` per PEP 621, or the legacy `[tool.poetry.dependencies]`/`[tool.poetry.group.*]`) with versions marked `unresolved (no lockfile)` — the transitive tree is incomplete by construction.

License resolution for a Python package (in order, first signal wins): the installed package's `.dist-info/METADATA` `License-Expression` field (PEP 639, a real SPDX expression) → the legacy `License` field → `Classifier: License :: OSI Approved :: ...` Trove classifiers mapped to an SPDX id → the on-disk `LICENSE`/`licenses/` file, fingerprinted → `README`. If the `License`/`License-Expression` field and a classifier both resolve but **disagree** (e.g. `License: MIT` alongside an `Apache License` classifier), the package is flagged `REVIEW` rather than silently trusting one signal over the other. If no `.venv`/`venv` environment is found next to the manifest, packages are still listed (name/version/direct/dev) but their disk-backed license lookup is skipped — they resolve to `unknown` rather than crashing.

A project's own declared license is read from `pyproject.toml`'s `[project.license]` (PEP 621 — either `license = "MIT"` or `license = { text = "MIT" }`) or the legacy `[tool.poetry].license`. If a project has **both** a `package.json` and a `pyproject.toml` declaring *different* licenses, the `package.json`-declared license wins for conflict-checking purposes and licenseproof says so in a warning — pass `--project-license` to override that (or any) assumption explicitly.

**Not supported:** conda environments and Pipenv (`Pipfile`/`Pipfile.lock`) are not detected or parsed.

## Flags

| Flag | Default | Description |
|---|---|---|
| `scan [path]` | `.` | Command to scan a project. `path` is the project directory (defaults to the current directory). |
| `--production-only` | `true` | Skip `devDependencies`. On by default. |
| `--include-dev` | off | Include `devDependencies` in the scan (inverse of `--production-only`). |
| `--format <format>` | `summary` | Output format: `summary` (human-readable terminal report) or `json` (machine-readable, see [`docs/json-schema.md`](docs/json-schema.md)). |
| `--project-license <id>` | from `package.json` / `pyproject.toml` | Your own project's SPDX license id or expression, used to decide what conflicts with it. Overrides whatever `package.json`'s `license` field or `pyproject.toml`'s `[project.license]` / `[tool.poetry].license` says (including the npm-vs-pypi tie-break in a mixed project, see above). If nothing is declared anywhere, licenseproof assumes the strictest (proprietary-equivalent) rules and says so in the output. |
| `--fail-on <mode>` | `conflict` | What makes the process exit `1`: `conflict` (only `CONFLICT`-level packages), `review` (`CONFLICT` or `REVIEW`-level, i.e. also unrecognized licenses), or `never` (always exit `0`, report only). |
| `--no-color` | color on when output is a TTY | Disable ANSI color output — useful for CI logs or piping to a file. |

Run `licenseproof scan --help` for the same reference from the CLI itself.

## `report` command

`scan` is free and always available. `report` generates the paid report artifacts — HTML, PDF,
a third-party notices file, and SBOMs — from the exact same scan/resolve pipeline (no separate
resolution logic, so a `report` artifact and a `scan --format json` run against the same project
always agree on every underlying finding).

```bash
npx licenseproof report [path] --format <formats> [--out <path>] [--production-only | --include-dev] [--project-license <id>]
```

- `path` — project directory to scan (defaults to `.`), same as `scan`.
- `--format <formats>` (required — at least one) — one or more of `html`, `pdf`, `notices`,
  `sbom-cyclonedx`, `sbom-spdx`. Accepts a comma-separated list (`--format html,pdf`) *or* repeated
  flags (`--format html --format pdf`) — both forms work, and can be mixed. An unrecognized value
  fails clearly with exit code `2` naming the bad value and the valid set, rather than being
  silently ignored; duplicates are de-duplicated.
  - `html` → `report.html` — a single self-contained file (cover header, executive summary,
    findings, full inventory, methodology appendix, provenance footer). Zero external references
    of any kind — opens directly from a `file://` URL, forever, with no network access.
  - `pdf` → `report.pdf` — the same HTML report printed through a real installed browser, with a
    true per-page footer. See [PDF reports](#pdf-reports) below for the Chrome/Chromium/Edge
    requirement and the honest fallback behavior when none is found.
  - `notices` → `THIRD_PARTY_NOTICES.txt` — every package grouped by its resolved license string,
    followed once per group by that license's full text (vendored text when available, else the
    package's own on-disk license file, else an explicit "text unavailable" note — never
    fabricated, never silently omitted).
  - `sbom-cyclonedx` → `sbom.cyclonedx.json` — a CycloneDX 1.5 Software Bill of Materials.
  - `sbom-spdx` → `sbom.spdx.json` — an SPDX 2.3 document.
- `--out <path>` — reconciles the brief's singular `--out <file>` with multi-format requests:
  - Exactly **one** format requested and `--out` given → honored literally as a **file path**,
    written exactly there.
  - **Multiple** formats requested → `--out` (if given) is treated as a **directory**; each
    artifact is written under it using its default filename (`report.html`, `report.pdf`,
    `THIRD_PARTY_NOTICES.txt`, `sbom.cyclonedx.json`, `sbom.spdx.json`), created if it doesn't
    exist. There's no way to force directory semantics for a single-format request — pass more
    than one `--format` value, or write to the file path directly and move it afterward.
  - `--out` **omitted entirely**, regardless of format count → defaults to `./licenseproof-report/`
    (created if needed), matching the original spec's stated default directory.
- `--production-only` / `--include-dev` — same meaning as `scan`.
- `--project-license <id>` — same meaning as `scan`.

**Exit codes:** `0` on success (stdout lists every artifact path written); `2` on any tool/runtime
error — an unknown or missing `--format`, no supported project found at `path`, or (PDF only) no
installed Chrome/Chromium/Edge found. Unlike `scan`, `report` has no `--fail-on`/conflict-driven
exit code — it exits `0` once the artifacts are actually written, regardless of what they contain.

Run `licenseproof report --help` for the same reference from the CLI itself.

### Real output samples

Every format, rendered from two real fixtures, is committed in this repo so you can look at actual
output without running anything:

- [`fixtures/report-samples/conflict-demo/`](fixtures/report-samples/conflict-demo/) — a proprietary
  (`"license": "UNLICENSED"`) npm project depending on the real `ffmpeg-static` package
  (`GPL-3.0-or-later`), which genuinely resolves to a `CONFLICT` finding.
- [`fixtures/report-samples/mixed-dogfood/`](fixtures/report-samples/mixed-dogfood/) — this repo's
  own npm dependency tree plus [Ruff](https://github.com/astral-sh/ruff)'s real PyPI dependency
  tree, scanned together with `--include-dev` (Ruff declares no *production* Python dependencies,
  so `--include-dev` is what makes the PyPI side of this sample non-empty) as one combined
  multi-ecosystem report.

Note on reproducibility: the SBOM formats embed a randomly generated `serialNumber` /
`documentNamespace` UUID, and every format embeds the scan timestamp — re-running the commands
above against the same fixtures will always produce byte-different (but equally valid) output.
That's expected, not a bug; the committed samples are a point-in-time illustration, not a golden
file any test re-renders and compares byte-for-byte.

## PDF reports

The `report` command can render the HTML report to PDF (`--format pdf`). The PDF is the same
report printed through a real browser, so the two artifacts can never drift apart. It adds one
thing the standalone HTML file cannot portably provide: a true **per-page footer** carrying
`LicenseProof <tool version> · data <data version> · <scan timestamp> · page N` on every page.
(The HTML file's own print stylesheet carries the same provenance text as a single static footer
at the end of the content — per-page numbering isn't achievable in portable, cross-browser print
CSS, which is exactly why the PDF path exists.)

**PDF output requires an installed Chrome, Chromium, or Edge.** licenseproof uses `puppeteer-core`,
which drives a browser you already have — it never downloads a bundled Chromium, and it never
makes a network call. These standard locations are checked automatically (first match wins, and
only the paths valid for your OS are probed):

| OS | Locations checked |
|---|---|
| macOS | `/Applications/Google Chrome.app/…`, `/Applications/Chromium.app/…`, `/Applications/Microsoft Edge.app/…` |
| Linux | `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/microsoft-edge`, `/usr/bin/microsoft-edge-stable`, `/snap/bin/chromium` |
| Windows | `C:\Program Files\Google\Chrome\Application\chrome.exe` (and the x86 path), `C:\Program Files\Microsoft\Edge\Application\msedge.exe` (and the x86 path) |

If no browser is found, the command exits `2` and no PDF is written, reporting:

```
licenseproof report: No installed Chrome, Chromium, or Edge browser was found at any standard location. PDF generation requires one of these to be installed. Use --format html instead — no dependencies required.
```

Every other format (`html`, `notices`, `sbom-cyclonedx`, `sbom-spdx`) has **no browser requirement
of any kind** — the HTML report in particular is a single self-contained file with zero external
references, and is the recommended output if you'd rather not install a browser.

## Pricing

The `scan` command is **free forever** — both `--format summary` and `--format json`, completely
unrestricted. No time limit, no feature reduction, no account, no key. If all you need is to see
what's in your dependency tree and what conflicts with your project's license, you never pay
anything.

The `report` command generates the audit-ready artifacts — HTML and PDF reports, a
`THIRD_PARTY_NOTICES.txt` file, and an SPDX SBOM — and needs a license key:

| Tier | Price | What you get |
|---|---|---|
| **Individual** | **$29** | perpetual license, includes 1 year of data updates |
| **Agency** | **$99** | perpetual license, includes 1 year of data updates |

"Perpetual" is literal: a valid key unlocks report generation **forever**. The one-year window
covers updates to the vendored reference data (the SPDX license list, category, and conflict
rules) — when your installed data is newer than that window the tool still runs fully and simply
notes it. It never nags, degrades, or expires, and key verification is entirely offline: no
account, no phone-home, no network call at any point.

One SBOM format is deliberately free: **`sbom-cyclonedx`** (CycloneDX 1.5) needs no key, while
**`sbom-spdx`** (SPDX 2.3) is part of the paid tier. CycloneDX is the machine-readable SBOM most
CI pipelines and supply-chain scanners consume, so it stays free to keep licenseproof useful in an
automated pipeline without a key; the SPDX document, HTML/PDF reports, and the third-party notices
file are the human- and audit-facing artifacts the paid tier covers.

[See a real example report](assets/samples/report.html) — every format is generated from a real
demo project and committed in this repo. Buy a key at [licenseproof.dev](https://licenseproof.dev).

## Scope

licenseproof provides **informational categorization, not legal advice**. It identifies licenses and flags likely conflicts using fixed, vendored SPDX data and a reviewed rule set — it does not interpret your specific legal situation, and its category/conflict decisions are heuristics, not a legal opinion. Always have a lawyer review your actual license obligations before shipping.

Current coverage, honestly:
- **Ecosystems:** Node.js / npm (via `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`, in that priority order, falling back to declared `package.json` dependencies with a warning if no lockfile is present) **and** Python / PyPI (via `uv.lock`, `poetry.lock`, `requirements.txt`, or `pyproject.toml`, in the precedence order documented above). Both are detected independently — a project with markers for both is scanned and merged into one report.
- **Not supported:** conda environments, Pipenv (`Pipfile`/`Pipfile.lock`). Note as unsupported, not planned as a near-term gap-fill.
- **Report artifacts:** HTML, PDF, `THIRD_PARTY_NOTICES.txt`, and SBOM (CycloneDX 1.5 / SPDX 2.3) output is generated by the `report` command. PDF output additionally requires an installed Chrome/Chromium/Edge — see [PDF reports](#pdf-reports) above; no other format has any such requirement.
- **License keys:** the free `scan` command is unrestricted; the paid `report` command (except the free `sbom-cyclonedx` format) requires a license key — see [Pricing](#pricing) above. Key verification is fully offline: no account, no network call, no phone-home.
- **Monorepos:** not supported yet — a workspace root scans only its own top-level `package.json`, with a warning.
- **No network access:** all license data (SPDX license list, category rules, conflict explanations, the classifier→SPDX map) ships vendored in the package; the tool itself never fetches anything over the network at scan time, for either ecosystem.

## License

licenseproof is source-available under the [Elastic License 2.0](LICENSE). It's free to use — including commercially, on your own projects and for your own clients — but you may not resell it as a hosted or managed service, and you may not remove, disable, or circumvent its license-key functionality.

## Development

See [`README-DEV.md`](README-DEV.md) for build/test instructions and the codebase's internal shape.
