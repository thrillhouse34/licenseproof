/**
 * Pure parser for a pinned `requirements.txt`.
 *
 * `requirements.txt` carries NO transitive dependency-tree information — it is a
 * flat list of lines. This parser therefore produces a flat list of packages,
 * exactly like npm's `declaredDepsOnlyFallback`: every parsed package is treated
 * as `direct: true`, `paths: [[name]]`, `pathCountAtLeast: 1`.
 *
 * Only the strict `name==version` form counts as a resolvable pin (the spec's
 * edge case #10). Anything else — git/URL/local-path installs, unpinned ranges
 * (`>=`, `~=`, `*`, no specifier at all), extras-only lines — is recorded as an
 * `unresolvable` entry rather than crashing or being silently dropped, so the
 * caller can surface it. The `-r other.txt` / `--index-url ...` / other pip
 * option lines are recognized and skipped (they are directives, not packages).
 */

export interface RequirementsPinnedPackage {
  name: string;
  version: string;
}

/**
 * A requirement line that is present but NOT a clean `name==version` pin
 * (git URL, local path, unpinned range, etc). Kept so callers can warn about
 * it — never silently dropped, never crashes the scan.
 */
export interface RequirementsUnresolvable {
  /** The original line (trimmed), for diagnostics. */
  raw: string;
  /** The package name if one could be extracted, else undefined. */
  name?: string;
}

export interface ParsedRequirements {
  pinned: RequirementsPinnedPackage[];
  unresolvable: RequirementsUnresolvable[];
}

/**
 * A PEP 508 name is `[A-Za-z0-9]` at the ends with `-`, `_`, `.` allowed
 * internally. We keep it permissive but anchored so we don't misread an option
 * or a URL as a name.
 */
const NAME_RE = '[A-Za-z0-9][A-Za-z0-9._-]*';
// `name==version`, optionally with extras (`name[extra1,extra2]==1.0`).
// Extras are allowed on the name side and simply ignored for the pin.
const PINNED_RE = new RegExp(`^(${NAME_RE})(?:\\[[^\\]]*\\])?==([^\\s;]+)$`);
// A leading name we can at least report on for unresolvable lines.
const LEADING_NAME_RE = new RegExp(`^(${NAME_RE})`);

/** pip option / directive lines that are not package requirements. */
function isOptionLine(line: string): boolean {
  // `-r req.txt`, `-c constraints.txt`, `-e .`, `--index-url ...`,
  // `--extra-index-url`, `--find-links`, `--hash=...`, `--no-binary`, etc.
  return line.startsWith('-');
}

/**
 * Strip an inline comment. pip treats ` #` (whitespace-preceded hash) as the
 * start of a comment; a `#` with no preceding whitespace is part of the token
 * (e.g. a URL fragment `#egg=name`). A full-line comment starts with `#`.
 */
function stripComment(line: string): string {
  if (line.startsWith('#')) return '';
  const idx = line.search(/\s#/);
  return idx === -1 ? line : line.slice(0, idx);
}

/**
 * Strip a PEP 508 environment marker (`; python_version >= "3.8"`). We do NOT
 * evaluate markers — we only remove them so the `name==version` extraction is
 * clean. The value part before the `;` is returned trimmed.
 */
function stripMarker(line: string): string {
  const idx = line.indexOf(';');
  return idx === -1 ? line : line.slice(0, idx).trim();
}

export function parseRequirementsTxt(contents: string): ParsedRequirements {
  const pinned: RequirementsPinnedPackage[] = [];
  const unresolvable: RequirementsUnresolvable[] = [];

  // Handle line continuations (`\` at end of line joins with the next line),
  // which pip supports.
  const logicalLines: string[] = [];
  let buffer = '';
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.endsWith('\\')) {
      buffer += line.slice(0, -1);
      continue;
    }
    logicalLines.push(buffer + line);
    buffer = '';
  }
  if (buffer) logicalLines.push(buffer);

  for (const logical of logicalLines) {
    let line = stripComment(logical).trim();
    if (line === '') continue;
    if (isOptionLine(line)) continue;

    line = stripMarker(line);
    if (line === '') continue;

    const pin = PINNED_RE.exec(line);
    if (pin) {
      pinned.push({ name: pin[1], version: pin[2] });
      continue;
    }

    // Not a clean pin — record as unresolvable with a best-effort name.
    const nameMatch = LEADING_NAME_RE.exec(line);
    unresolvable.push({ raw: line, name: nameMatch ? nameMatch[1] : undefined });
  }

  return { pinned, unresolvable };
}
