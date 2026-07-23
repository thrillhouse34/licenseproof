# LicenseProof JSON Output Schema

`licenseproof scan --format json` outputs a single JSON object matching this schema. `schemaVersion` is `1` as of Milestone 3; future changes are additive only without a version bump — a breaking change bumps `schemaVersion`.

## Top level

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` | Schema version. |
| `toolVersion` | `string` | licenseproof's own version (from `package.json`). |
| `dataVersion` | `string` | Vendored SPDX data version (`data/manifest.json`'s `dataVersion`, format `YYYY.MM.DD` or `YYYY.MM.DD.N` — the trailing `.N` is a same-day sub-version used when `/data` changes more than once in a single day). |
| `scanTimestamp` | `string` | ISO 8601 timestamp of when the scan ran. |
| `projectName` | `string` | Scanned project's name. |
| `projectLicense` | `{ id: string; wasUnspecified: boolean }` | The project license used for conflict-checking. `id` is `"unspecified"` when `wasUnspecified` is `true` (no declared/valid license found; strictest mode was assumed). |
| `summary` | object | `{ totalPackages, conflictCount, reviewCount, unknownCount, agplCount, agplInformationalCount, byEcosystem }` — `reviewCount` excludes UNKNOWNs (they're counted separately in `unknownCount`). `agplCount` and `agplInformationalCount` answer different questions and are NOT interchangeable: `agplCount` counts every package with `conflict.agplNetworkedUse: true`, regardless of `conflict.level` — this includes packages where AGPL is actually blocking (`conflict.level: "CONFLICT"`) as well as packages where AGPL only appears as a non-chosen `OR` branch. `agplInformationalCount` is the narrower count of packages in the `agpl-informational` bucket specifically — AGPL present only as a non-chosen `OR` branch (e.g. `MIT OR AGPL-3.0-only` resolved to the MIT branch), `conflict.level` is `NONE`, nothing is blocked. This is the same bucket the terminal renderer's "agpl-noted" section reports. A package with a bare/blocking AGPL license (`conflict.level: "CONFLICT"`) counts toward `agplCount` but never toward `agplInformationalCount`. `byEcosystem` (Milestone 4) is `Record<string, number>` mapping each contributing ecosystem id (`"npm"`, `"pypi"`) to its package count; only ecosystems that produced at least one package appear as keys, and the values always sum to `totalPackages`. It is present on every scan (a single-ecosystem scan has one key), and lets a consumer reconcile a merged multi-ecosystem report. |
| `packages` | array | Every resolved package, sorted by severity (conflict, AGPL-informational, review, unknown, clean) then name. |
| `warnings` | `string[]` | Scan-level warnings (e.g. no lockfile found, monorepo not supported). |

## Per-package entry

| Field | Type | Description |
|---|---|---|
| `name`, `version` | `string` | |
| `ecosystem` | `string` | `"npm"` \| `"pypi"` (Milestone 5). Which ecosystem this package belongs to — a pure pass-through of the same tag `summary.byEcosystem` aggregates, exposed per-package so a consumer of a merged multi-ecosystem report can tell which ecosystem an individual entry came from without re-deriving it. |
| `direct`, `dev` | `boolean` | |
| `license` | `string` | Resolved license — a plain SPDX id, or the full original expression string (including any `WITH` clause) when the declared license was an expression. `"UNKNOWN"` if unresolved. |
| `licenseIds` | `string[]` | Every SPDX id present (all OR branches, single-element for a plain id). |
| `category` | `string` | `permissive` \| `weak-copyleft` \| `strong-copyleft` \| `noncommercial` \| `public-domain` \| `unknown`. |
| `confidence` | `string` | `high` \| `medium` \| `low`. |
| `source` | `string` | Which resolution step won: `metadata` \| `expression` \| `classifier` \| `license-file` \| `readme` \| `none`. `classifier` is PyPI-only (Milestone 4): the license came from mapping a Trove `License :: ...` classifier through `data/classifier-to-spdx.json` — used when no clean `License-Expression`/`License` metadata field was present. |
| `normalizedFrom` | `string?` | Set when a deprecated SPDX id was normalized (e.g. `"GPL-3.0"` → license shows `"GPL-3.0-only"`). |
| `conflict` | `{ level, explanationKey, agplNetworkedUse }` | `level` is `CONFLICT` \| `REVIEW` \| `NONE`. `explanationKey` indexes `data/conflict-explanations.json` (`null` if `NONE`). `agplNetworkedUse` is `true` whenever any AGPL id is present anywhere in `licenseIds`, even as a non-chosen OR branch — check `level` too before treating this as blocking. |
| `paths` | `string[][]` | Up to 3 example root-to-package dependency chains. |
| `pathCountAtLeast` | `number` | Count of distinct chains — a lower bound once capped or cycle-touched; never render as an exact count when higher than `paths.length`. |
| `hasDiskPath` | `boolean` | Whether the package was confirmed present on disk. The raw path is never exposed in this output. |

## Ordering

`packages` is sorted deterministically: severity bucket first (conflict, then AGPL-informational, then review, then unknown, then clean), alphabetically by `name` within each bucket. No color codes appear anywhere in JSON output.
