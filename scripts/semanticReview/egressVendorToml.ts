/**
 * The TOML reading half of the egress vendor shape generator: it turns the pinned Gitleaks config's
 * `[[rules]]` array-of-tables into typed `Rule` records and counts the raw rule headers. It is a
 * separate module only so each file stays within the repository's size ceilings.
 */

export type Rule = {
    readonly id: string;
    readonly description: string;
    readonly regex?: string;
    readonly path?: string;
    readonly entropy?: number;
    readonly secretGroup?: number;
    readonly keywords: readonly string[];
};

/**
 * A minimal TOML reader for the Gitleaks config's `[[rules]]` array-of-tables. It is not a general
 * TOML parser: it reads exactly the layout the pinned config emits — `[[rules]]` and
 * `[[rules.allowlists]]` headers at column zero, unindented single-space `key = value` pairs,
 * single-line basic/literal/multi-line-literal strings, numbers, and quoted arrays (single-line, or
 * multi-line with four-space-indented elements) — and refuses any other line with its number and
 * reason, so a legal-but-unexpected form can never be silently mis-read. Inside that accepted
 * grammar the field scanner below is adequate.
 */
const KEY_LINE =
    /^(id|description|regex|path|entropy|secretGroup|keywords|paths|regexes|title|minVersion|stopwords|regexTarget|condition) = (.*)$/;
const SINGLE_LINE_ARRAY = /^\[(?:"[^"\][]*")(?:\s*,\s*"[^"\][]*")*\]$/;

/** Refuses any line outside the accepted grammar, naming the line and the reason. */
function validateGrammar(toml: string): void {
    const lines = toml.split('\n');
    let inArrayKey: string | null = null;
    for (let i = 0; i < lines.length; i += 1) {
        const line = (lines[i] ?? '').replace(/\r$/, '');
        const n = i + 1;
        if (inArrayKey !== null) {
            if (line === ']') {
                inArrayKey = null;
                continue;
            }
            if (isArrayElement(line, inArrayKey)) {
                continue;
            }
            throw new Error(
                `line ${n}: expected an indented quoted array element or "]", found ${JSON.stringify(line)}`
            );
        }
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        if (line === '[[rules]]' || line === '[[rules.allowlists]]' || line === '[allowlist]') {
            continue;
        }
        const keyMatch = KEY_LINE.exec(line);
        if (keyMatch === null) {
            throw new Error(
                `line ${n}: expected a header, comment, or "key = value" at column zero, found ${JSON.stringify(line)}`
            );
        }
        const value = keyMatch[2] ?? '';
        validateValue(n, keyMatch[1] ?? '', value);
        if (value === '[') {
            inArrayKey = keyMatch[1] ?? '';
        }
    }
    if (inArrayKey !== null) {
        throw new Error('unterminated array at end of config');
    }
}

/** Validates one value in the accepted grammar. */
function validateValue(n: number, key: string, value: string): void {
    if (value === '' || value === '[') {
        return;
    }
    if (value.startsWith('[')) {
        if (!SINGLE_LINE_ARRAY.test(value)) {
            throw new Error(
                `line ${n}: malformed single-line array for field "${key}" (elements must be double-quoted, no bracket inside)`
            );
        }
        return;
    }
    if (isStringValue(value)) {
        return;
    }
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        return;
    }
    throw new Error(`line ${n}: unrecognized value for field "${key}": ${JSON.stringify(value)}`);
}

/** Whether `s` is a single-line basic, literal, or multi-line-literal string that closes on one line. */
function isStringValue(s: string): boolean {
    if (s.startsWith("'''")) {
        return s.endsWith("'''") && s.length >= 7 && !s.slice(3, -3).includes("'''");
    }
    if (s.startsWith('"')) {
        return /^"([^"\\]|\\.)*"$/.test(s);
    }
    if (s.startsWith("'")) {
        return /^'[^']*'$/.test(s);
    }
    return false;
}

/**
 * Whether a line is an indented array element (one or more comma-separated quoted strings, optional
 * trailing comma). Keyword words carry no bracket inside; allowlist regex/path strings may carry
 * brackets and quotes, so only a `'''` delimiter run is excluded there.
 */
function isArrayElement(line: string, key: string): boolean {
    if (!line.startsWith('    ')) {
        return false;
    }
    const body = line.slice(4).trim();
    if (key === 'keywords') {
        return /^"[^"[\]]*"(?:\s*,\s*"[^"[\]]*")*,?$/.test(body);
    }
    return /^(?:'''(?:(?!''')[^])*'''|"[^"]*")(?:\s*,\s*(?:'''(?:(?!''')[^])*'''|"[^"]*"))*,?$/.test(body);
}

/**
 * Normalizes CRLF line endings so an LF input and its CRLF twin derive identical rules. A lone-CR
 * ending is left untouched, so a lone-CR file stays outside the emitted grammar and is refused.
 */
function normalizeLines(toml: string): string {
    return toml.replaceAll('\r\n', '\n');
}

export function parseRules(toml: string): Rule[] {
    const text = normalizeLines(toml);
    validateGrammar(text);
    const blocks: string[][] = [];
    let current: string[] | null = null;
    for (const line of text.split('\n')) {
        if (isRuleHeader(line)) {
            current = [];
            blocks.push(current);
        } else if (current !== null) {
            current.push(line);
        }
    }
    return blocks.map(parseRuleBlock).filter((rule): rule is Rule => rule !== null);
}

/**
 * Counts raw `[[rules]]` headers; the grammar gate has already guaranteed their exact form, so this
 * count is independent of the block splitter and any dropped block is visible to the generator.
 */
export function countRuleBlocks(toml: string): number {
    let count = 0;
    for (const line of normalizeLines(toml).split('\n')) {
        if (isRuleHeader(line)) {
            count += 1;
        }
    }
    return count;
}

function isRuleHeader(line: string): boolean {
    return line === '[[rules]]';
}

/** Decodes a TOML basic string's escape sequences; literal strings are left untouched by the caller. */
function unescapeBasicString(value: string): string {
    return value.replaceAll(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|["\\bfnrt])/g, (_match, escape: string) => {
        switch (escape[0]) {
            case '"':
                return '"';
            case '\\':
                return '\\';
            case 'b':
                return '\b';
            case 'f':
                return '\f';
            case 'n':
                return '\n';
            case 'r':
                return '\r';
            case 't':
                return '\t';
            case 'u':
            case 'U':
                return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
            default:
                return escape;
        }
    });
}

/** Trims a multiline literal string body: the newline after the delimiter, and any carriage returns. */
function decodeMultilineLiteralString(value: string): string {
    return value
        .replace(/^\r?\n/, '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n');
}

/**
 * Decodes a TOML multiline basic string body: trims the newline that may immediately follow the
 * opening delimiter, folds a line-ending backslash continuation, normalizes CRLF, then unescapes.
 */
function decodeMultilineBasicString(value: string): string {
    let s = value;
    // A newline immediately following the opening delimiter is trimmed (TOML 1.0).
    s = s.replace(/^\r?\n/, '');
    // A backslash at the end of a line continues it: the backslash and every following whitespace and
    // newline up to the next non-whitespace character are trimmed.
    s = s.replaceAll(/\\[ \t]*(?:\r?\n[ \t]*)+/g, '');
    // Normalize remaining newlines so a CRLF config leaves no stray carriage return in the regex.
    s = s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    return unescapeBasicString(s);
}

/** The field names this reader consumes; a field-shaped line inside a string would shadow one of them. */
const FIELD_KEY = /^(?:id|description|regex|path|entropy|secretGroup|keywords)\s*=/;

/** Decodes a string value's raw text (with its delimiters) into the value the scanner would read. */
function decodeStringValue(raw: string): string | undefined {
    if (raw.startsWith("'''") && raw.endsWith("'''")) {
        return decodeMultilineLiteralString(raw.slice(3, -3));
    }
    if (raw.startsWith('"""') && raw.endsWith('"""')) {
        return decodeMultilineBasicString(raw.slice(3, -3));
    }
    if (raw.startsWith('"') && raw.endsWith('"')) {
        return unescapeBasicString(raw.slice(1, -1));
    }
    if (raw.startsWith("'") && raw.endsWith("'")) {
        return raw.slice(1, -1);
    }
    return undefined;
}

/** Refuses when a multi-line string's content carries a field-shaped line that would shadow the real field. */
function assertNoFieldLine(content: string, key: string): void {
    for (const line of content.split('\n')) {
        if (FIELD_KEY.test(line.trim())) {
            throw new Error(`a field-shaped line appears inside the "${key}" string value`);
        }
    }
}

/** Consumes one value beginning at `rest` on `startLine`, advancing past multi-line strings and arrays. */
function consumeValue(
    lines: string[],
    startLine: number,
    key: string,
    rest: string
): { readonly value: string; readonly nextLine: number } {
    if (rest.startsWith("'''") || rest.startsWith('"""')) {
        const delimiter = rest.slice(0, 3);
        let content = rest.slice(3);
        let line = startLine;
        let closed = false;
        for (;;) {
            const closeIdx = content.indexOf(delimiter);
            if (closeIdx !== -1) {
                assertNoFieldLine(content.slice(0, closeIdx), key);
                content = content.slice(0, closeIdx);
                closed = true;
                break;
            }
            line += 1;
            if (line >= lines.length) {
                break;
            }
            content += `\n${lines[line] ?? ''}`;
        }
        if (!closed) {
            throw new Error(`unterminated multi-line string for field "${key}"`);
        }
        return { value: `${delimiter}${content}${delimiter}`, nextLine: line + 1 };
    }
    if (rest.startsWith('[')) {
        let content = rest;
        let line = startLine;
        while (!content.includes(']')) {
            line += 1;
            if (line >= lines.length) {
                throw new Error(`unterminated array for field "${key}"`);
            }
            content += `\n${lines[line] ?? ''}`;
        }
        return { value: content, nextLine: line + 1 };
    }
    return { value: rest, nextLine: startLine + 1 };
}

/**
 * Reads each top-level `key = value` pair of a rule block, skipping every line inside a string or
 * array value and tolerating leading whitespace before a key. A duplicate key or a field-shaped line
 * inside a string is refused rather than guessed.
 */
function readTopLevelEntries(lines: string[]): Map<string, string> {
    const entries = new Map<string, string>();
    let i = 0;
    while (i < lines.length) {
        const trimmed = (lines[i] ?? '').trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            i += 1;
            continue;
        }
        // A table header (e.g. `[[rules.allowlists]]`) ends the rule's own key region; its fields
        // belong to the sub-table, not to the rule, so they must not be read as the rule's.
        if (trimmed.startsWith('[')) {
            break;
        }
        const keyMatch = /^(?:(?:([A-Za-z0-9_-]+)|"([^"]+)"|'([^']+)')\s*=\s*)([\s\S]*)$/.exec(trimmed);
        if (keyMatch === null) {
            i += 1;
            continue;
        }
        const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? '';
        if (entries.has(key)) {
            throw new Error(`duplicate top-level field "${key}"`);
        }
        const consumed = consumeValue(lines, i, key, keyMatch[4] ?? '');
        entries.set(key, consumed.value);
        i = consumed.nextLine;
    }
    return entries;
}

function parseRuleBlock(lines: string[]): Rule | null {
    const entries = readTopLevelEntries(lines);
    const id = entries.get('id');
    const decodedId = id === undefined ? undefined : decodeStringValue(id);
    if (decodedId === undefined) {
        return null;
    }
    const descriptionRaw = entries.get('description');
    const regexRaw = entries.get('regex');
    const pathRaw = entries.get('path');
    const entropyRaw = entries.get('entropy');
    const secretGroupRaw = entries.get('secretGroup');
    const keywordsRaw = entries.get('keywords');
    const keywords: string[] = [];
    if (keywordsRaw !== undefined) {
        const arrayMatch = /^\[([\s\S]*)\]$/.exec(keywordsRaw);
        if (arrayMatch !== null) {
            keywords.push(...Array.from((arrayMatch[1] ?? '').matchAll(/(["'])([^"']*)\1/g), (m) => m[2] ?? ''));
        }
    }
    return {
        id: decodedId,
        description: descriptionRaw === undefined ? '' : (decodeStringValue(descriptionRaw) ?? ''),
        regex: regexRaw === undefined ? undefined : decodeStringValue(regexRaw),
        path: pathRaw === undefined ? undefined : decodeStringValue(pathRaw),
        entropy: entropyRaw === undefined ? undefined : Number(entropyRaw),
        secretGroup: secretGroupRaw === undefined ? undefined : Number(secretGroupRaw),
        keywords,
    };
}
