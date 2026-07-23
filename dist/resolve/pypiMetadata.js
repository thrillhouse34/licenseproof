"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMetadata = parseMetadata;
// A field line: an RFC822 header name (letter, then letters/digits/hyphens),
// a colon, an optional single space, then the value (possibly empty).
const FIELD_RE = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/;
function parseMetadata(contents) {
    const classifiers = [];
    let licenseExpression;
    let license;
    // The lower-cased name of the field the current line belongs to, so a
    // continuation line knows what to append to. Only the fields we store react to
    // continuations; every other field is still tracked so an unrelated field's
    // continuation is correctly ignored rather than mis-attributed.
    let currentField;
    for (const line of contents.split(/\r?\n/)) {
        // Blank line terminates the header block; the body/description follows and
        // must not be parsed as fields.
        if (line.trim() === '')
            break;
        // Continuation line (starts with space or tab): append to the current field.
        if (/^[ \t]/.test(line) && currentField) {
            const cont = line.trim();
            if (currentField === 'classifier') {
                // Append to the most recently seen classifier value.
                if (classifiers.length > 0)
                    classifiers[classifiers.length - 1] += ` ${cont}`;
            }
            else if (currentField === 'license-expression') {
                licenseExpression = licenseExpression ? `${licenseExpression} ${cont}` : cont;
            }
            else if (currentField === 'license') {
                license = license ? `${license} ${cont}` : cont;
            }
            continue;
        }
        const m = line.match(FIELD_RE);
        if (!m)
            continue; // not a field line and not a recognized continuation — ignore defensively
        const name = m[1].toLowerCase();
        const value = m[2];
        currentField = name;
        if (name === 'classifier') {
            classifiers.push(value);
        }
        else if (name === 'license-expression') {
            licenseExpression = value; // last occurrence wins (defensive; should never legitimately repeat)
        }
        else if (name === 'license') {
            license = value; // last occurrence wins
        }
        // All other fields: tracked via currentField (for correct continuation
        // handling) but their values are not stored.
    }
    return { licenseExpression, license, classifiers };
}
//# sourceMappingURL=pypiMetadata.js.map