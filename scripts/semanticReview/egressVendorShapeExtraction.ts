/**
 * The pure extraction behind `scripts/generateEgressVendorShapes.ts`: it turns the pinned Gitleaks
 * config's `[[rules]]` into the three tables the egress screen reads — value-complete vendor shapes,
 * vendor key names from keyword-proximity rules, and the residual that neither family expresses.
 *
 * Everything here is deterministic and network-free; the generator that runs it by hand is the only
 * caller. It is a separate module from the generator only so each file stays within the repository's
 * size ceilings, not because any of this runs at a different time.
 */

import { countRuleBlocks, parseRules, type Rule } from './egressVendorToml.ts';

/** The minimum number of literal characters a vendor prefix must carry to be distinctive. */
export const MIN_PREFIX_LENGTH = 4;

/** Generic key-name words already recognised by `sensitive.ts`; deriving them again would widen the bare-`key` hole. */
const GENERIC_KEY_WORDS = new Set([
    'access',
    'api',
    'auth',
    'key',
    'credential',
    'creds',
    'passwd',
    'password',
    'secret',
    'token',
    'pwd',
]);

export type EgressVendorShape = {
    readonly reason: string;
    readonly parts: readonly string[];
    readonly tail: string;
    readonly fixture: readonly string[];
    /** `iu` when the source rule's leading `(?i)` also covers the prefix; `u` otherwise. */
    readonly flags: 'iu' | 'u';
    /** Whether the value body (the tail) is case-insensitive in the source rule. */
    readonly bodyInsensitive: boolean;
};

export type ResidualRule = {
    readonly id: string;
    readonly reason: string;
};

export type DerivedEgressVendorShapes = {
    readonly shapes: readonly EgressVendorShape[];
    readonly keyNames: readonly string[];
    readonly residual: readonly ResidualRule[];
    readonly counts: Readonly<{
        readonly blockCount: number;
        readonly totalRules: number;
        readonly valueCompleteRules: number;
        readonly valueCompleteEntropyGated: number;
        readonly keywordRules: number;
        readonly residualByReason: Readonly<Record<string, number>>;
    }>;
};

const ASSIGNMENT_GLUE = '(?:=|>|:{1,3}=|\\|\\||:|=>|\\?=|,)';
const PROXIMITY_LEADIN = '[\\w.-]{0,50}?';

function hasAssignmentGlue(regex: string): boolean {
    return regex.includes(ASSIGNMENT_GLUE);
}

function hasProximityLeadin(regex: string): boolean {
    return regex.includes(PROXIMITY_LEADIN);
}

/** Strips a leading `\b`, `(?i)`, and `(?-i)` so the prefix parser sees the anchor itself. */
function stripLeadingFlags(regex: string): string {
    let s = regex;
    for (;;) {
        const next = s
            .replace(/^\\b/, '')
            .replace(/^\(\?i\)/, '')
            .replace(/^\(\?-i\)/, '');
        if (next === s) {
            return s;
        }
        s = next;
    }
}

/**
 * Strips a single outer `(...)` wrapper when the whole expression sits inside one and the remainder
 * is only a trailing boundary, so `\b((?:a|b)…)\b` and `\b(PREFIX…)(?:BOUNDARY)` expose their prefix.
 */
function stripOuterCapture(s: string): string {
    if (!s.startsWith('(')) {
        return s;
    }
    const close = matchingParen(s, 0);
    if (close === -1) {
        return s;
    }
    const inner = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (rest === '' || rest === '\\b' || rest === '$' || rest.startsWith('(?:')) {
        return inner;
    }
    return s;
}

/** Strips every outer `(...)` wrapper and its boundary, e.g. the double capture of `((HRKU-AA…))`. */
function stripOuterCaptures(s: string): string {
    let current = s;
    for (;;) {
        const next = stripOuterCapture(current);
        if (next === current) {
            return current;
        }
        current = next;
    }
}

type PrefixAtom =
    | { readonly kind: 'literal'; readonly text: string }
    | { readonly kind: 'alternation'; readonly branches: readonly (readonly PrefixAtom[])[] }
    | { readonly kind: 'class'; readonly text: string };

/**
 * Parses the leading vendor prefix of a value-complete regex into atoms and returns the tail
 * (everything after the prefix). It stops at the first construct that is tail material — a
 * quantifier, a shorthand class, a boundary, or a group whose branches carry quantifiers.
 */
function parsePrefix(s: string): { readonly atoms: readonly PrefixAtom[]; readonly tail: string } {
    const atoms: PrefixAtom[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i] ?? '';
        if (c === '(' && s[i + 1] === '?' && s[i + 2] === ':') {
            const close = matchingParen(s, i);
            if (close === -1) {
                break;
            }
            const inner = s.slice(i + 3, close);
            const branches = splitAlternatives(inner);
            if (branches.length > 1) {
                const parsed = branches.map(parseBranchAtoms);
                if (parsed.every((branch): branch is readonly PrefixAtom[] => branch !== null)) {
                    atoms.push({ kind: 'alternation', branches: parsed });
                    i = close + 1;
                    continue;
                }
                break;
            }
            const branch = parseBranchAtoms(inner);
            if (branch !== null) {
                atoms.push(...branch);
                i = close + 1;
                continue;
            }
            break;
        }
        if (c === '[') {
            const close = s.indexOf(']', i + 1);
            if (close === -1) {
                break;
            }
            atoms.push({ kind: 'class', text: s.slice(i, close + 1) });
            i = close + 1;
            continue;
        }
        if (c === '\\') {
            const escaped = s[i + 1];
            if (escaped !== undefined && /[./_-]/.test(escaped)) {
                atoms.push({ kind: 'literal', text: escaped });
                i += 2;
                continue;
            }
            break;
        }
        if (/[A-Za-z0-9_.\-/~]/.test(c)) {
            let end = i;
            while (end < s.length && /[A-Za-z0-9_.\-/~]/.test(s[end] ?? '')) {
                end += 1;
            }
            atoms.push({ kind: 'literal', text: s.slice(i, end) });
            i = end;
            continue;
        }
        break;
    }
    return { atoms, tail: s.slice(i) };
}

/** Parses one alternation branch (no top-level `|`) into atoms, or null when it is not literal. */
function parseBranchAtoms(branch: string): readonly PrefixAtom[] | null {
    const atoms: PrefixAtom[] = [];
    let i = 0;
    while (i < branch.length) {
        const c = branch[i] ?? '';
        if (c === '[') {
            const close = branch.indexOf(']', i + 1);
            if (close === -1) {
                return null;
            }
            atoms.push({ kind: 'class', text: branch.slice(i, close + 1) });
            i = close + 1;
            continue;
        }
        if (c === '\\' && branch[i + 1] !== undefined && /[./_-]/.test(branch[i + 1] ?? '')) {
            atoms.push({ kind: 'literal', text: branch[i + 1] ?? '' });
            i += 2;
            continue;
        }
        if (/[A-Za-z0-9_.\-/~]/.test(c)) {
            let end = i;
            while (end < branch.length && /[A-Za-z0-9_.\-/~]/.test(branch[end] ?? '')) {
                end += 1;
            }
            atoms.push({ kind: 'literal', text: branch.slice(i, end) });
            i = end;
            continue;
        }
        return null;
    }
    return atoms;
}

function matchingParen(s: string, open: number): number {
    let depth = 0;
    for (let i = open; i < s.length; i += 1) {
        const c = s[i];
        if (c === '\\') {
            i += 1;
            continue;
        }
        if (c === '(') {
            depth += 1;
        } else if (c === ')') {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function splitAlternatives(inner: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i += 1) {
        const c = inner[i];
        if (c === '\\') {
            i += 1;
            continue;
        }
        if (c === '[') {
            const close = inner.indexOf(']', i + 1);
            i = close === -1 ? i : close;
            continue;
        }
        if (c === '(') {
            depth += 1;
        } else if (c === ')') {
            depth -= 1;
        } else if (c === '|' && depth === 0) {
            parts.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(inner.slice(start));
    return parts;
}

function expandAlternation(sequences: readonly string[][], branches: readonly (readonly PrefixAtom[])[]): string[][] {
    const next: string[][] = [];
    for (const seq of sequences) {
        for (const branch of branches) {
            let text = '';
            for (const atom of branch) {
                if (atom.kind !== 'alternation') {
                    text += atom.text;
                }
            }
            next.push([...seq, text]);
        }
    }
    return next;
}

/**
 * Expands prefix atoms into every literal prefix they describe. A top-level trailing character class
 * moves into the tail (a class inside an alternation branch is rejected by the caller).
 */
function expandPrefix(atoms: readonly PrefixAtom[]): {
    readonly prefixes: readonly string[];
    readonly tailPrefix: string;
} {
    let sequences: string[][] = [[]];
    let tailPrefix = '';
    for (const atom of atoms) {
        if (atom.kind === 'literal') {
            sequences = sequences.map((seq) => [...seq, atom.text]);
        } else if (atom.kind === 'alternation') {
            sequences = expandAlternation(sequences, atom.branches);
        } else {
            tailPrefix = atom.text;
        }
    }
    return { prefixes: sequences.map((seq) => seq.join('')), tailPrefix };
}

/**
 * Rewrites Go-style inline case flags into JavaScript's scoped modifier groups. A bare `(?i)` or
 * `(?-i)` sets the flag for the remainder of its enclosing group (the whole tail here, since the
 * prefix parser stops at the first flag), so it becomes `(?i:…)` / `(?-i:…)` over exactly that
 * remainder; scoped `(?i:…)` / `(?-i:…)` groups are already legal JavaScript and pass through.
 */
function rewriteCaseFlags(s: string): string {
    const groupCloseIndexes: number[] = [];
    const pendingCloses: number[] = [];
    const out: string[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i] ?? '';
        if (c === '\\') {
            out.push(c, s[i + 1] ?? '');
            i += 2;
            continue;
        }
        if (s.startsWith('(?i)', i) && s[i + 3] !== ':') {
            out.push('(?i:');
            pendingCloses.push(groupCloseIndexes.at(-1) ?? s.length);
            i += 4;
            continue;
        }
        if (s.startsWith('(?-i)', i) && s[i + 4] !== ':') {
            out.push('(?-i:');
            pendingCloses.push(groupCloseIndexes.at(-1) ?? s.length);
            i += 5;
            continue;
        }
        if (c === '(') {
            const close = matchingParen(s, i);
            groupCloseIndexes.push(close === -1 ? s.length : close);
            out.push(c);
            i += 1;
            continue;
        }
        if (c === ')') {
            while (pendingCloses.length > 0 && pendingCloses[pendingCloses.length - 1] === i) {
                out.push(')');
                pendingCloses.pop();
            }
            out.push(c);
            groupCloseIndexes.pop();
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    while (pendingCloses.length > 0) {
        out.push(')');
        pendingCloses.pop();
    }
    return out.join('');
}

/** Converts Go-only escapes to JavaScript ones: `\-` (outside a class) and `\z` (end of string). */
function normalizeGoEscapes(s: string): string {
    const out: string[] = [];
    let inClass = false;
    for (let i = 0; i < s.length; i += 1) {
        const c = s[i] ?? '';
        if (c === '[') {
            inClass = true;
            out.push(c);
            continue;
        }
        if (c === ']' && inClass) {
            inClass = false;
            out.push(c);
            continue;
        }
        if (!inClass && c === '\\' && s[i + 1] === '-') {
            out.push('-');
            i += 1;
            continue;
        }
        if (!inClass && c === '\\' && s[i + 1] === 'z') {
            out.push('$');
            i += 1;
            continue;
        }
        out.push(c);
    }
    return out.join('');
}

/** Rewrites inline case flags into scoped groups, then normalizes Go-only escapes. */
function normalizeTail(tail: string): string {
    return normalizeGoEscapes(rewriteCaseFlags(tail));
}

/** Strips a trailing word boundary, anchor, or gitleaks terminator from a raw tail, before flag rewriting. */
function cleanTail(tail: string): string {
    return tail
        .replace(/\(\?:\[\\x60'"\\s;\]\|\\\\\[nr\]\|\$\)$/, '')
        .replace(/\\b$/, '')
        .replace(/\$$/, '');
}

/** Whether a tail's case-insensitivity spans its whole body: a single `(?i:…)` group covering everything. */
function isFullyInsensitiveTail(tail: string): boolean {
    return tail.startsWith('(?i:') && matchingParen(tail, 0) === tail.length - 1;
}

/** Picks one character that belongs to a character-class body, for the fixture. */
function pickClassChar(body: string): string {
    if (body.startsWith('[[:')) {
        return 'a';
    }
    if (body.startsWith('[^')) {
        // A negated class: a punctuation char that none of our negated classes exclude.
        return '.';
    }
    const inner = body.replace(/^\[/, '').replace(/\]$/, '');
    if (inner === '') {
        return 'a';
    }
    const rangeMatch = /^([^\\])-/.exec(inner);
    if (rangeMatch !== null) {
        return rangeMatch[1] ?? 'a';
    }
    const escaped = /^\\(.)/.exec(inner);
    if (escaped !== null) {
        return escaped[1] ?? 'a';
    }
    return inner[0] ?? 'a';
}

function concretizeEscaped(escaped: string): string {
    if (escaped === 'w') {
        return 'a';
    }
    if (escaped === 'd') {
        return '0';
    }
    if (escaped === 's') {
        return ' ';
    }
    return escaped;
}

function concretizeGroup(inner: string): string {
    const normalized = inner
        .replace(/^\?:/, '')
        .replace(/^\?i:/, '')
        .replace(/^\?-i:/, '');
    return concretizeTail(splitAlternatives(normalized)[0] ?? '');
}

function concretizeQuantifier(spec: string, previous: string): string {
    const [minRaw] = spec.split(',');
    const min = Number.parseInt(minRaw ?? '', 10);
    return previous.repeat(Number.isNaN(min) ? 1 : Math.max(0, min));
}

/** Produces a concrete body string that matches `tail`, for the self-checking fixture. */
function concretizeTail(tail: string): string {
    const out: string[] = [];
    let i = 0;
    while (i < tail.length) {
        const c = tail[i] ?? '';
        if (c === '[') {
            const close = tail.indexOf(']', i + 1);
            if (close === -1) {
                i += 1;
                continue;
            }
            out.push(pickClassChar(tail.slice(i, close + 1)));
            i = close + 1;
            continue;
        }
        if (c === '\\') {
            out.push(concretizeEscaped(tail[i + 1] ?? ''));
            i += 2;
            continue;
        }
        if (c === '(') {
            const close = matchingParen(tail, i);
            if (close === -1) {
                i += 1;
                continue;
            }
            out.push(concretizeGroup(tail.slice(i + 1, close)));
            i = close + 1;
            continue;
        }
        if (c === '{') {
            const close = tail.indexOf('}', i + 1);
            if (close === -1) {
                i += 1;
                continue;
            }
            const previous = out.pop() ?? 'a';
            out.push(concretizeQuantifier(tail.slice(i + 1, close), previous));
            i = close + 1;
            continue;
        }
        if (c === '+' || c === '*') {
            const previous = out.pop() ?? 'a';
            out.push(c === '+' ? previous : '');
            i += 1;
            continue;
        }
        if (c === '?') {
            out.pop();
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    return out.join('');
}

/** A human-readable reason derived from the rule's description, falling back to its id. */
function deriveReason(rule: Rule): string {
    const noun = /^[A-Z][a-z]+ (?:a|an) (.+?),/
        .exec(rule.description)?.[1]
        ?.replace(/^(?:possible|potential) /, '')
        ?.replace(/^(?:pattern (?:that (?:may|might|can) indicate|that resembles|resembling) )/, '');
    if (noun !== undefined && noun.length > 0) {
        return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
    }
    const family = rule.id.replace(/-(?:token|key|secret|id|password|credential|cookie)(?:$|-)/u, '');
    const titled = family.replaceAll('-', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase());
    return `${/^[aeiou]/i.test(titled) ? 'an' : 'a'} ${titled} credential`;
}

/**
 * Chunks an emitted literal into short fragments. Every fragment stays well under the shortest
 * opaque run the pinned scanner's `generic-api-key` rule accepts (ten characters), so no fragment
 * can carry a keyword adjacent to an opaque value, and the scanner cannot bridge two fragments
 * through the `', '` that separates array entries. The screen joins the fragments back together at
 * runtime (`parts.join('')`), so the chunking is invisible to matching.
 */
const PART_CHUNK_SIZE = 4;

function splitParts(prefix: string): string[] {
    const parts: string[] = [];
    for (let i = 0; i < prefix.length; i += PART_CHUNK_SIZE) {
        parts.push(prefix.slice(i, i + PART_CHUNK_SIZE));
    }
    return parts;
}

function isNotPrefixAnchored(regex: string): boolean {
    return /http|PRIVATE KEY|\(\?P<|=>|value=\\?|curl/.test(regex);
}

function atomsHaveClassInAlternation(atoms: readonly PrefixAtom[]): boolean {
    return atoms.some(
        (atom) => atom.kind === 'alternation' && atom.branches.some((branch) => branch.some((b) => b.kind === 'class'))
    );
}

type Extraction =
    | { readonly kind: 'shapes'; readonly shapes: readonly EgressVendorShape[]; readonly keywords: readonly string[] }
    | { readonly kind: 'keywords'; readonly keywords: readonly string[] }
    | { readonly kind: 'residual'; readonly reason: string };

function extract(rule: Rule): Extraction {
    if (rule.secretGroup !== undefined) {
        return { kind: 'residual', reason: 'secretGroup indirection' };
    }
    const regex = rule.regex;
    if (regex === undefined) {
        if (rule.path !== undefined) {
            return { kind: 'residual', reason: 'keys on a filename, and the screen classifies content' };
        }
        return { kind: 'residual', reason: 'rule has neither a readable regex nor a path' };
    }
    if (hasAssignmentGlue(regex) || hasProximityLeadin(regex)) {
        // A keyword-proximity rule is only covered when its keywords survive the name filter; one
        // whose keywords are all generic or prefix fragments would be reported under coverage while
        // firing nothing, so it is recorded instead.
        if (deriveKeyNames(rule.keywords).length === 0) {
            return { kind: 'residual', reason: 'keyword-proximity rule yields no usable key name' };
        }
        return { kind: 'keywords', keywords: rule.keywords };
    }
    const stripped = stripOuterCaptures(stripLeadingFlags(regex));
    if (isNotPrefixAnchored(stripped)) {
        return { kind: 'residual', reason: 'pattern is not a literal prefix' };
    }
    const { atoms, tail } = parsePrefix(stripped);
    const leading = atoms[0];
    if (leading === undefined || leading.kind === 'class') {
        return { kind: 'residual', reason: 'pattern is not a literal prefix' };
    }
    if (splitAlternatives(tail).length > 1) {
        return { kind: 'residual', reason: 'alternation reaches into the tail' };
    }
    if (atomsHaveClassInAlternation(atoms)) {
        return { kind: 'residual', reason: 'prefix alternation carries a character class' };
    }
    if (atoms.slice(0, -1).some((atom) => atom.kind === 'class')) {
        return { kind: 'residual', reason: 'character class sits inside the prefix' };
    }
    const { prefixes, tailPrefix } = expandPrefix(atoms);
    if (prefixes.some((prefix) => prefix.length < MIN_PREFIX_LENGTH)) {
        return { kind: 'residual', reason: 'prefix shorter than four distinctive characters' };
    }
    const reason = deriveReason(rule);
    const leadingInsensitive = hasLeadingInsensitiveFlag(regex);
    const flags: 'iu' | 'u' = leadingInsensitive ? 'iu' : 'u';
    const finalTail = normalizeTail(cleanTail(`${tailPrefix}${tail}`));
    const bodyInsensitive = (flags === 'iu' && !finalTail.includes('(?-i')) || isFullyInsensitiveTail(finalTail);
    const fixture = splitParts(concretizeTail(finalTail));
    const shapes = prefixes.map((prefix) => ({
        reason,
        parts: splitParts(prefix),
        tail: finalTail,
        fixture,
        flags,
        bodyInsensitive,
    }));
    return { kind: 'shapes', shapes, keywords: [] };
}

function hasLeadingInsensitiveFlag(regex: string): boolean {
    return regex.replace(/^\\b/, '').startsWith('(?i)');
}

/** The vendor key names: keyword-proximity family names, minus the generic bare-`key` class. */
function deriveKeyNames(keywords: readonly string[]): string[] {
    const deduped = Array.from(new Set(keywords));
    const nonGeneric = deduped.filter((name) => !GENERIC_KEY_WORDS.has(name));
    const wordLike = nonGeneric.filter((name) => /^[a-z][a-z0-9_-]{2,}$/.test(name));
    return wordLike.filter((name) => !name.includes('__') && !/[-_]$/.test(name)).sort();
}

/** Parses and classifies every rule in the fetched config into the three tables the screen reads. */
export function deriveEgressVendorShapes(toml: string): DerivedEgressVendorShapes {
    const rules = parseRules(toml);
    const blockCount = countRuleBlocks(toml);
    if (rules.length === 0) {
        throw new Error(
            `refusing to derive an empty egress table: ${blockCount} [[rules]] headers but no readable rule`
        );
    }
    const shapes: EgressVendorShape[] = [];
    const rawKeyNames: string[] = [];
    const residual: ResidualRule[] = [];
    let valueCompleteRules = 0;
    let valueCompleteEntropyGated = 0;
    let keywordRules = 0;
    for (const rule of rules) {
        const result = extract(rule);
        if (result.kind === 'shapes') {
            shapes.push(...result.shapes);
            valueCompleteRules += 1;
            if (rule.entropy !== undefined) {
                valueCompleteEntropyGated += 1;
            }
        } else if (result.kind === 'keywords') {
            keywordRules += 1;
            rawKeyNames.push(...result.keywords);
        } else {
            residual.push({ id: rule.id, reason: result.reason });
        }
    }
    const residualByReason: Record<string, number> = {};
    for (const rule of residual) {
        residualByReason[rule.reason] = (residualByReason[rule.reason] ?? 0) + 1;
    }
    return {
        shapes,
        keyNames: deriveKeyNames(rawKeyNames),
        residual,
        counts: {
            blockCount,
            totalRules: rules.length,
            valueCompleteRules,
            valueCompleteEntropyGated,
            keywordRules,
            residualByReason,
        },
    };
}
