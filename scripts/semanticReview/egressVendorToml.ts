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
 * TOML parser: it reads the fields the generator needs and ignores every allowlist sub-table, but it
 * accepts each of TOML's four string forms (basic, literal, and both multiline variants), either
 * quote style for `keywords`, quoted keys, and whitespace-tolerant `=` spacing, so a legal form is
 * never mistaken for an absent field. The config is auto-generated, so its shape is stable across
 * the bumps this script is meant to survive.
 */
export function parseRules(toml: string): Rule[] {
    const blocks: string[][] = [];
    let current: string[] | null = null;
    for (const line of toml.split('\n')) {
        if (isRuleHeader(line)) {
            current = [];
            blocks.push(current);
        } else if (current !== null) {
            current.push(line);
        }
    }
    return blocks.map(parseRuleBlock).filter((rule): rule is Rule => rule !== null);
}

/** Whether a line is a legal `[[rules]]` array-of-tables header: bare, single-quoted, or double-quoted. */
function matchRuleHeader(line: string): boolean {
    const header = stripInlineComment(line).trim();
    return /^\[\[\s*(?:rules|'rules'|"rules")\s*\]\]$/.test(header);
}

/**
 * Counts raw `[[rules]]` headers by scanning every line for a legal header form, independently of
 * the block splitter. A header the splitter drops is therefore visible as a count that exceeds the
 * classified-rule count, and the generator refuses instead of writing a table that lost a family.
 */
export function countRuleBlocks(toml: string): number {
    let count = 0;
    for (const line of toml.split('\n')) {
        if (matchRuleHeader(line)) {
            count += 1;
        }
    }
    return count;
}

function isRuleHeader(line: string): boolean {
    return matchRuleHeader(line);
}

function stripInlineComment(line: string): string {
    const hash = line.indexOf('#');
    return hash === -1 ? line : line.slice(0, hash);
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
