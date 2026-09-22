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

/** Counts raw `[[rules]]` headers independently of the splitter, so a header it fails to consume is visible. */
export function countRuleBlocks(toml: string): number {
    let count = 0;
    for (const line of toml.split('\n')) {
        const header = line.trim().replace(/#.*$/, '').trim();
        if (/^\[\[\s*rules\s*\]\]$/.test(header)) {
            count += 1;
        }
    }
    return count;
}

function isRuleHeader(line: string): boolean {
    return /^\[\[\s*rules\s*\]\]$/.test(stripInlineComment(line).trim());
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

/**
 * Reads a string-valued TOML field in any of the four string forms. The key may be bare, single- or
 * double-quoted, with optional whitespace around `=`, and a basic string is TOML-unescaped so the
 * derived regex is byte-identical to the value the scanner would read.
 */
function readStringField(block: string, key: string): string | undefined {
    const keyPattern = `(?:${key}|"${key}"|'${key}')\\s*=\\s*`;
    const literalMulti = block.match(new RegExp(`^${keyPattern}'''([\\s\\S]*?)'''`, 'm'));
    if (literalMulti !== null) {
        return literalMulti[1];
    }
    const basicMulti = block.match(new RegExp(`^${keyPattern}"""([\\s\\S]*?)"""`, 'm'));
    if (basicMulti !== null) {
        return unescapeBasicString(basicMulti[1] ?? '');
    }
    const basic = block.match(new RegExp(`^${keyPattern}"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
    if (basic !== null) {
        return unescapeBasicString(basic[1] ?? '');
    }
    const literal = block.match(new RegExp(`^${keyPattern}'([^']*)'`, 'm'));
    if (literal !== null) {
        return literal[1];
    }
    return undefined;
}

function parseRuleBlock(lines: string[]): Rule | null {
    const block = lines.join('\n');
    const id = readStringField(block, 'id');
    if (id === undefined) {
        return null;
    }
    const description = readStringField(block, 'description') ?? '';
    const regex = readStringField(block, 'regex');
    const path = readStringField(block, 'path');
    const secretGroupMatch = block.match(/^secretGroup = (\d+)/m);
    const entropyMatch = block.match(/^entropy = ([\d.]+)/m);
    const keywordsMatch = block.match(/^keywords = \[([\s\S]*?)\]/m);
    const keywords: string[] = [];
    if (keywordsMatch !== null) {
        keywords.push(...Array.from((keywordsMatch[1] ?? '').matchAll(/(["'])([^"']*)\1/g), (m) => m[2] ?? ''));
    }
    return {
        id,
        description,
        regex,
        path,
        entropy: entropyMatch === null ? undefined : Number(entropyMatch[1]),
        secretGroup: secretGroupMatch === null ? undefined : Number(secretGroupMatch[1]),
        keywords,
    };
}
