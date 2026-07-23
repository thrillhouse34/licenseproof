import { parse as parseToml } from 'smol-toml';

/**
 * Pure parser for `pyproject.toml`, producing ONLY the declared dependency NAME
 * lists (no version information — declared deps carry only PEP 508 constraint
 * strings, not resolved versions).
 *
 * Two callers depend on this exact return shape, so it is designed to serve
 * both:
 *   1. The declared-only fallback tier (this milestone's Task 3) — used when no
 *      lockfile is present. `mainDeps` become the reported packages; every group
 *      in `groupDeps` is treated as `dev: true`.
 *   2. The `poetry.lock` parser (Task 4) — needs the main-vs-group split to
 *      cross-reference group membership onto the lockfile's packages (poetry.lock
 *      itself carries no per-package group field). Task 4 imports THIS function
 *      rather than re-parsing `pyproject.toml` a second time.
 *
 * Supports both dependency-declaration shapes:
 *   - PEP 621 standard: `[project.dependencies]` (array of PEP 508 strings) +
 *     `[project.optional-dependencies]` (extras — each extra group is a
 *     dev-style group here).
 *   - Legacy Poetry-only: `[tool.poetry.dependencies]` (main, note the special
 *     `python` key is NOT a real dependency and is dropped) +
 *     `[tool.poetry.group.<name>.dependencies]` / legacy `[tool.poetry.dev-dependencies]`
 *     (every non-main group). Used when a `pyproject.toml` has no `[project]`
 *     table at all but IS a Poetry project.
 *
 * If BOTH shapes are present (a project mid-migration that declares PEP 621
 * `[project]` AND keeps `[tool.poetry]`), the PEP 621 `[project]` table wins as
 * the standard, and the Poetry tables are ignored — matching pip/build's own
 * precedence.
 */

export interface ParsedPyproject {
  /** Names declared as main/production dependencies. */
  mainDeps: string[];
  /**
   * Names declared under any non-main group, keyed by group name
   * (PEP 621 extra name, or Poetry group name). Every group here is treated as
   * `dev: true` by consumers — the existing contract has only a boolean, no
   * named groups.
   */
  groupDeps: Record<string, string[]>;
}

/**
 * Extract the bare distribution name from a PEP 508 requirement string.
 * Examples:
 *   "requests>=2.31.0"          -> "requests"
 *   "requests[security]>=2.31"  -> "requests"
 *   "ruff == 0.1.0"             -> "ruff"
 *   "importlib-metadata; python_version < '3.8'" -> "importlib-metadata"
 * Returns undefined if no leading name can be found (e.g. a URL-only entry).
 */
function nameFromPep508(req: string): string | undefined {
  const trimmed = req.trim();
  // Name is the leading run before any of: whitespace, extras `[`, a version
  // operator, a marker `;`, or an `@` (URL form `name @ https://...`).
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed);
  return match ? match[1] : undefined;
}

function namesFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = nameFromPep508(item);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Poetry's `[tool.poetry.dependencies]` is a TABLE keyed by package name (values
 * are version constraints / inline tables), NOT an array — so the KEYS are the
 * names. The literal `python` key is a Python-version constraint, not a package
 * dependency, and must be dropped.
 */
function namesFromPoetryTable(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).filter((k) => k !== 'python');
}

export function parsePyprojectToml(contents: string): ParsedPyproject {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(contents) as Record<string, unknown>;
  } catch {
    // A malformed pyproject.toml yields no declared deps rather than crashing
    // the whole scan — the orchestrator surfaces the empty result as an
    // effectively-empty project.
    return { mainDeps: [], groupDeps: {} };
  }

  const project = doc.project as Record<string, unknown> | undefined;

  // --- PEP 621 standard shape wins when present ---
  if (project) {
    const mainDeps = namesFromArray(project.dependencies);
    const groupDeps: Record<string, string[]> = {};
    const optional = project['optional-dependencies'];
    if (optional && typeof optional === 'object' && !Array.isArray(optional)) {
      for (const [groupName, deps] of Object.entries(optional as Record<string, unknown>)) {
        groupDeps[groupName] = namesFromArray(deps);
      }
    }
    return { mainDeps, groupDeps };
  }

  // --- Legacy Poetry-only shape ---
  const tool = doc.tool as Record<string, unknown> | undefined;
  const poetry = tool?.poetry as Record<string, unknown> | undefined;
  if (poetry) {
    const mainDeps = namesFromPoetryTable(poetry.dependencies);
    const groupDeps: Record<string, string[]> = {};

    // Modern grouped form: [tool.poetry.group.<name>.dependencies]
    const group = poetry.group as Record<string, unknown> | undefined;
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      for (const [groupName, groupBody] of Object.entries(group)) {
        const body = groupBody as Record<string, unknown> | undefined;
        groupDeps[groupName] = namesFromPoetryTable(body?.dependencies);
      }
    }

    // Legacy flat dev group: [tool.poetry.dev-dependencies]
    const legacyDev = namesFromPoetryTable(poetry['dev-dependencies']);
    if (legacyDev.length > 0) {
      groupDeps['dev'] = [...(groupDeps['dev'] ?? []), ...legacyDev];
    }

    return { mainDeps, groupDeps };
  }

  return { mainDeps: [], groupDeps: {} };
}
