/**
 * Parser for a PyPI package's `.dist-info/METADATA` file (the RFC822-style
 * header block defined by the Python Core Metadata spec / PEP 566 / PEP 639).
 *
 * We only extract the three fields the license-resolution pipeline (Milestone 4
 * Task 6) consumes:
 *   - `License-Expression` (PEP 639, a valid SPDX expression) — the preferred,
 *     modern, machine-parseable signal.
 *   - `License` (legacy free-text or single-id field) — a weaker signal that may
 *     or may not be a clean SPDX id ("Apache 2.0", "MIT License", "UNKNOWN" all
 *     appear in the wild).
 *   - every `Classifier:` line (there are usually many — language/OS/framework/
 *     topic classifiers, not just license ones). We keep the RAW, unfiltered list
 *     here; filtering to `License ::`-prefixed classifiers happens where the list
 *     is CONSUMED (the resolver), not at parse time, so a future milestone can use
 *     the rest without re-reading the file.
 *
 * The file format: `Field-Name: value` lines, one per field. A field can repeat
 * (notably `Classifier:`), and a line beginning with whitespace CONTINUES the
 * previous field's value (real files do this for long `Description` fields; it's
 * rare-to-nonexistent for the three fields we care about, but we accumulate
 * defensively rather than crash if it appears). The header block ends at the
 * first blank line — everything after it is the free-text body (the long package
 * description), which we must NOT parse as fields (a body line like
 * "License: do whatever you want" would otherwise pollute the real field).
 */
export interface ParsedMetadata {
  licenseExpression?: string;
  license?: string;
  classifiers: string[];
}

// A field line: an RFC822 header name (letter, then letters/digits/hyphens),
// a colon, an optional single space, then the value (possibly empty).
const FIELD_RE = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/;

export function parseMetadata(contents: string): ParsedMetadata {
  const classifiers: string[] = [];
  let licenseExpression: string | undefined;
  let license: string | undefined;

  // The lower-cased name of the field the current line belongs to, so a
  // continuation line knows what to append to. Only the fields we store react to
  // continuations; every other field is still tracked so an unrelated field's
  // continuation is correctly ignored rather than mis-attributed.
  let currentField: string | undefined;

  for (const line of contents.split(/\r?\n/)) {
    // Blank line terminates the header block; the body/description follows and
    // must not be parsed as fields.
    if (line.trim() === '') break;

    // Continuation line (starts with space or tab): append to the current field.
    if (/^[ \t]/.test(line) && currentField) {
      const cont = line.trim();
      if (currentField === 'classifier') {
        // Append to the most recently seen classifier value.
        if (classifiers.length > 0) classifiers[classifiers.length - 1] += ` ${cont}`;
      } else if (currentField === 'license-expression') {
        licenseExpression = licenseExpression ? `${licenseExpression} ${cont}` : cont;
      } else if (currentField === 'license') {
        license = license ? `${license} ${cont}` : cont;
      }
      continue;
    }

    const m = line.match(FIELD_RE);
    if (!m) continue; // not a field line and not a recognized continuation — ignore defensively

    const name = m[1].toLowerCase();
    const value = m[2];
    currentField = name;

    if (name === 'classifier') {
      classifiers.push(value);
    } else if (name === 'license-expression') {
      licenseExpression = value; // last occurrence wins (defensive; should never legitimately repeat)
    } else if (name === 'license') {
      license = value; // last occurrence wins
    }
    // All other fields: tracked via currentField (for correct continuation
    // handling) but their values are not stored.
  }

  return { licenseExpression, license, classifiers };
}
