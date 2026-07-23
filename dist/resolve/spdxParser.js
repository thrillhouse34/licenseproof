"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSpdxExpression = parseSpdxExpression;
exports.flattenLicenseIds = flattenLicenseIds;
exports.mostPermissiveBranch = mostPermissiveBranch;
function tokenize(raw) {
    const tokens = [];
    const re = /\(|\)|[^\s()]+/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
        const text = match[0];
        if (text === '(')
            tokens.push({ kind: '(', value: text });
        else if (text === ')')
            tokens.push({ kind: ')', value: text });
        else if (text.toUpperCase() === 'AND')
            tokens.push({ kind: 'AND', value: text });
        else if (text.toUpperCase() === 'OR')
            tokens.push({ kind: 'OR', value: text });
        else if (text.toUpperCase() === 'WITH')
            tokens.push({ kind: 'WITH', value: text });
        else
            tokens.push({ kind: 'id', value: text });
    }
    return tokens;
}
class Parser {
    tokens;
    pos = 0;
    constructor(tokens) {
        this.tokens = tokens;
    }
    peek() { return this.tokens[this.pos]; }
    next() {
        const t = this.tokens[this.pos];
        if (!t)
            throw new Error('Unexpected end of expression');
        this.pos++;
        return t;
    }
    parseExpression() {
        const expr = this.parseOr();
        if (this.pos !== this.tokens.length)
            throw new Error(`Unexpected trailing token "${this.peek()?.value}"`);
        return expr;
    }
    parseOr() {
        let left = this.parseAnd();
        while (this.peek()?.kind === 'OR') {
            this.next();
            left = { type: 'or', left, right: this.parseAnd() };
        }
        return left;
    }
    parseAnd() {
        let left = this.parseWith();
        while (this.peek()?.kind === 'AND') {
            this.next();
            left = { type: 'and', left, right: this.parseWith() };
        }
        return left;
    }
    parseWith() {
        const left = this.parsePrimary();
        if (this.peek()?.kind === 'WITH') {
            this.next();
            const exceptionToken = this.next();
            if (exceptionToken.kind !== 'id')
                throw new Error(`Expected exception name after WITH, got "${exceptionToken.value}"`);
            return { type: 'with', license: left, exception: exceptionToken.value };
        }
        return left;
    }
    parsePrimary() {
        const token = this.next();
        if (token.kind === '(') {
            const inner = this.parseOr();
            const closing = this.next();
            if (closing.kind !== ')')
                throw new Error(`Expected ")" but got "${closing.value}"`);
            return inner;
        }
        if (token.kind === 'id')
            return { type: 'license', id: token.value };
        throw new Error(`Unexpected token "${token.value}"`);
    }
}
function parseSpdxExpression(raw) {
    try {
        const asString = typeof raw === 'string' ? raw : String(raw ?? '');
        const trimmed = asString.trim();
        if (!trimmed)
            return { ok: false, raw };
        const tokens = tokenize(trimmed);
        const expr = new Parser(tokens).parseExpression();
        return { ok: true, expr };
    }
    catch {
        return { ok: false, raw };
    }
}
function flattenLicenseIds(expr) {
    switch (expr.type) {
        case 'license': return [expr.id];
        case 'or':
        case 'and': return [...flattenLicenseIds(expr.left), ...flattenLicenseIds(expr.right)];
        case 'with': return flattenLicenseIds(expr.license);
    }
}
function mostPermissiveBranch(expr, permissiveIds) {
    if (expr.type === 'license')
        return [expr.id];
    if (expr.type === 'with')
        return mostPermissiveBranch(expr.license, permissiveIds);
    if (expr.type === 'and')
        return flattenLicenseIds(expr);
    const leftIds = flattenLicenseIds(expr.left);
    const rightIds = flattenLicenseIds(expr.right);
    if (leftIds.every((id) => permissiveIds.has(id)))
        return leftIds;
    if (rightIds.every((id) => permissiveIds.has(id)))
        return rightIds;
    return flattenLicenseIds(expr);
}
//# sourceMappingURL=spdxParser.js.map