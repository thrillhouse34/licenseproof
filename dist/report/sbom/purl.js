"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPurl = toPurl;
/**
 * Build a Package URL (purl) for a resolved package, per the authoritative
 * purl-spec type definitions (https://github.com/package-url/purl-spec — the
 * `docs/types/definitions/{npm,pypi}-definition.md` files, confirmed by direct
 * read during Milestone 5 planning, NOT guessed from memory).
 *
 *  - npm: the namespace (scope) and name are CASE-SENSITIVE — never lowercased
 *    ("old packages with mixed case names were grandfathered in"). A scoped
 *    package's leading `@` sign is ALWAYS percent-encoded as `%40`, and the scope
 *    and name are joined by a literal `/`. So `@babel/core@7.24.0` becomes
 *    `pkg:npm/%40babel/core@7.24.0`, matching the spec's own worked example
 *    `pkg:npm/%40angular/animation@12.3.1`.
 *  - pypi: the name is normalized to lowercase with underscore `_` replaced by a
 *    dash `-` (spec note: "a PyPI package name must be lowercased and underscore
 *    _ replaced with a dash -"). The spec's dot→underscore rule applies ONLY to
 *    distribution (sdist/wheel) *filenames*, not to the purl name component, so
 *    dots in a package name are intentionally left as-is here.
 */
function toPurl(pkg) {
    if (pkg.ecosystem === 'pypi') {
        const name = pkg.name.toLowerCase().replace(/_/g, '-');
        return `pkg:pypi/${name}@${pkg.version}`;
    }
    // npm. A scoped name looks like `@scope/name`; encode the leading `@` as `%40`
    // and keep the `/` between scope and name literal.
    if (pkg.name.startsWith('@')) {
        const slash = pkg.name.indexOf('/');
        if (slash > 0) {
            const scope = pkg.name.slice(1, slash); // drop the leading @
            const bare = pkg.name.slice(slash + 1);
            return `pkg:npm/%40${scope}/${bare}@${pkg.version}`;
        }
    }
    return `pkg:npm/${pkg.name}@${pkg.version}`;
}
//# sourceMappingURL=purl.js.map