/**
 * Content-based screening for anything this tool sends to the provider.
 *
 * The publication detector in `reviewDossier` is deliberately not reused here, although both answer
 * "does this text carry a credential". The two have opposite costs. Publication refuses to write one
 * value, so a bare prefix like the GitHub token prefix is a cheap, sufficient answer — nothing is lost
 * by refusing. Egress withholds a region from assessment entirely, so a bare prefix is expensive: this
 * module's own source contains those prefixes as composed parts, and borrowing that list refused
 * thirteen of one change's thirty-two paths, including every file that implements the tool. Egress
 * therefore requires each shape to carry a value.
 *
 * This list is deliberately generalizing rather than enumerating. Successive reviews each found one
 * more vendor prefix missing from a per-vendor blacklist, which is a treadmill: the set of live
 * credential shapes is unbounded, so a list that must be complete cannot be finished. What is bounded
 * is the *form* a secret takes in source — a secret-named key assigned a long opaque value, a URI
 * carrying credentials, a secret in a query parameter, or a key with a recognizable prefix.
 *
 * The vendor prefixes are written as split parts because a screening module is exactly where
 * credential-shaped literals accumulate, and this repository's pull-request diff secret scan matches
 * those literals in source. Composing them keeps that required gate fully effective on this file
 * rather than exempting it.
 *
 * It remains defense in depth and never a claim that arbitrary source has been sanitized. Two evasions
 * are known and not covered: a secret split across concatenated literals or lines, and one encoded or
 * encrypted before it reaches source. Nothing here is a security boundary; the boundary is that this
 * tool is advisory and holds no authority.
 *
 * This screen is not a hand-written mirror of the pinned secret scanner. The vendor shapes below are
 * the retained families that the scanner cannot express as a literal prefix — a prefix shorter than
 * four characters, an alternation that carries a character class, or a family with no rule at all —
 * plus the mechanically derived families in `egressVendorShapes.ts`, which is generated from the
 * pinned Gitleaks config (`scripts/generateEgressVendorShapes.ts`) so a shape-anchored family the
 * scanner catches cannot be missing. Vendor family names from the scanner's keyword-proximity rules
 * are recognised as secret key names so those assignments reach the value test below.
 */

import { EGRESS_VENDOR_SHAPES, VENDOR_KEY_NAMES } from './egressVendorShapes.ts';

/**
 * A secret-named key: `account_key`, `apiKey`, `CLIENT_SECRET`, `auth-token`, `password`, the bare
 * `auth`, `creds`, and `access` the scanner's keyword alternation carries, plus the vendor family
 * names the scanner's keyword-proximity rules carry (`adafruit`, `datadog`, …).
 *
 * A bare `key` is deliberately absent. Including it made the identifier `KEY` a secret name, so
 * `KEY = 'workflowFileInventory'` and `KEYS: Record<...>` read as credentials — and because a
 * withheld region is not sent at all, ordinary constant declarations took whole files out of the
 * assessment. `key` sits inside too many ordinary identifiers (`keyboard`, `hotkey`) for the value
 * heuristic to carry alone, and `api` stays out beside it: the scanner itself restricts that
 * keyword's casing (`(?-i:[Aa]pi|API)`), and the word rides ordinary names like `rapid`.
 *
 * The other bare scanner keywords were restored after #4859: the pinned scanner flags
 * `auth = '<secret>'`, `creds = …`, and `my_aws_access = …` as generic-api-key while the screen
 * admitted them, so a secret under one of the commonest secret-variable names reached the provider.
 * The value heuristic separates their references (`auth = getAuth()`, `creds = credentials`) from
 * key material. The accepted cost is a long quoted single-word value on an identifier that merely
 * contains one of these names (`author = 'externalContributorName'`): it is withheld where the
 * scanner's entropy gate stays silent, because a quoted run reads as a value by construction.
 */
const SECRET_KEY_NAME_SOURCE = [
    'secret',
    'token',
    'passw(?:or)?d',
    'pwd',
    'api[_-]?key',
    'access[_-]?key',
    'account[_-]?key',
    'shared[_-]?access[_-]?key',
    'private[_-]?key',
    'client[_-]?secret',
    'auth[_-]?(?:token|key)',
    'credential',
    'creds',
    'auth',
    'access',
    'sas',
    'signature',
    ...VENDOR_KEY_NAMES,
].join('|');

const SECRET_KEY_NAME = new RegExp(`(?:${SECRET_KEY_NAME_SOURCE})`, 'iu');

/**
 * Where a secret-named key is followed by a candidate value: the separator, and then either a quoted
 * string or an unquoted opaque run. There is deliberately no left boundary: a word boundary would
 * treat `_` as a word character and the preceding hump letter in camelCase as one too, so
 * `SOME_TOKEN`, `apiToken`, `dbPassword` and their like — the dominant secret-naming vocabulary —
 * would stop matching. The value heuristic separates those names from ordinary identifiers; a bare
 * mixed-case alphabetic value is a reference, not key material.
 *
 * The segment between the name and the operator mirrors the scanner's gap (`[\w.-]{0,50}?` before
 * the keyword, `[ \t\w.-]{0,20}` and then `[\s'"]{0,3}` after it — the prefix is moot here because
 * this rule has no left boundary). Dashes and dots join the word-character run, so `token-helper`
 * and `token.js` reach the operator, and so does the first half of a compound operator the scanner
 * rides the gap across (`->`, `-=`, `.=`); up to three mixed spaces or quotes follow, so `token''`
 * and `token ' =` reach it too. The previous gap — word characters, at most one quote directly
 * after the name, then whitespace — admitted every one of those while the pinned scanner flagged
 * them as generic-api-key (#4859). The first alternative keeps that revision's unbounded
 * whitespace: a run longer than the scanner's twenty-three-character budget is withheld where the
 * scanner stays silent, the same safe-direction over-withhold #4859 records as context for the
 * bare branch and does not ask this change to narrow.
 *
 * The separator is the scanner's operator alternation (`=|>|:{1,3}=|\|\||:|=>|\?=|,`), so a
 * walrus `:=`, an arrow `=>`, a doubled `==` (the opening run below absorbs the second `=`), a `||`
 * fallback, a Makefile-style `?=`, and a comma-separated `key, value` all reach the value test; the
 * screen used to read only `=` and `:`, so each of those forms was admitted (#4579). The quoted
 * alternative then reads the scanner's opening run — one to five of `'`, `"`, a backtick,
 * whitespace, or `=` (the scanner's `[\x60'"\s=]{0,5}`, the whitespace sharing the five-character
 * budget), requiring at least one true delimiter so a bare value keeps its own branch — and a
 * terminator that is any single delimiter, whitespace, a semicolon, an escaped newline (`\\[nr]`),
 * or end of input. The bare alternative absorbs the same run's whitespace and `=` before its value,
 * so `key == value` reaches the value test whether or not the value is quoted. The captured run
 * stops at the first delimiter, whitespace, semicolon, or backslash, so a mismatched pair (`'…"`), a
 * value closed by end of input, a space, a semicolon, an escaped newline, or a five-quote run are
 * all withheld, and a nested delimiter (`'''…"…'''`) or an escaped delimiter (`\"`) still ends the
 * run and is admitted. What stays deliberately unmodelled is
 * the scanner's entropy gate and value allowlist: the floor here is sixteen characters with no
 * entropy test, a policy #4579 records as context rather than a defect.
 */
const SECRET_ASSIGNMENT = new RegExp(
    `(?:${SECRET_KEY_NAME_SOURCE})[\\w.-]*(?:['"]?\\s*|[ \\t\\w.-]{0,20}[\\s'"]{0,3})(?:=|>|:{1,3}=|\\|\\||:|=>|\\?=|,)(?:` +
        `(?=['"\\x60\\s=]{0,4}['"\\x60])['"\\x60\\s=]{1,5}(?<quoted>[^'"\\x60\\s;\\\\]{16,})(?=['"\\x60\\s;]|\\\\[nr]|$)` +
        `|[\\s=]*(?<bare>[A-Za-z0-9+/_=.-]{16,})(?<after>[^\\s]?))`,
    'giu'
);

/** A key name occurrence, searched for inside a rejected assignment's value span. */
const SECRET_KEY_SEARCH = new RegExp(`(?:${SECRET_KEY_NAME_SOURCE})`, 'giu');

/**
 * The assignment's right half — the gap, operator, and value of SECRET_ASSIGNMENT unchanged —
 * anchored (`y`) where a candidate key's `[\w.-]` continuation stops inside a rejected value.
 */
const ASSIGNMENT_GAP_AND_VALUE = new RegExp(
    `(?:['"]?\\s*|[ \\t\\w.-]{0,20}[\\s'"]{0,3})(?:=|>|:{1,3}=|\\|\\||:|=>|\\?=|,)(?:` +
        `(?=['"\\x60\\s=]{0,4}['"\\x60])['"\\x60\\s=]{1,5}(?<quoted>[^'"\\x60\\s;\\\\]{16,})(?=['"\\x60\\s;]|\\\\[nr]|$)` +
        `|[\\s=]*(?<bare>[A-Za-z0-9+/_=.-]{16,})(?<after>[^\\s]?))`,
    'iyu'
);

/**
 * The same right half, probed inside a rejected *quoted* span, mirroring the pinned scanner's
 * two-branch value reach at this screen's own sixteen-character floor. The generic rule's
 * secret group is `[\w.=-]{10,150}` — bounded, and its mandatory trailing terminator is
 * unreachable from inside a longer run, so an unbroken run in that alphabet past 150 characters
 * is genuinely silent on the scanner — or `[a-z0-9][a-z0-9+/]{11,}={0,3}` — unbounded, so a
 * pure base64-alphabet run flags at any length (#4872 round 6: the round-5 revision kept only
 * the bounded half and admitted scanner-flagged secrets past it). The probe therefore pairs each
 * of its value classes with the second branch: a branch-2 scan ends at the first character
 * outside its alphabet — an operatorish `=`, `.`, `_`, `-`, or a delimiter — so one stop's work
 * stays proportional to the distance to the next operator rather than to the remaining tail,
 * which is what keeps an operator-dense one-line blob linear without capping the branch (#4872
 * round 5). The bare branch also takes the scanner's trailing terminator in place of the
 * round-5 run-boundary lookahead. The terminator implies the boundary, and the swap changes one
 * verdict class in the scanner's direction: a value cut by a character that is neither a run
 * character nor a scanner terminator (a comma, say) still matched under the lookahead and was
 * withheld there, while the scanner is silent on the line — the terminator form admits it
 * (#4872 round 7; the comma-cut pin in the spec holds that verdict). Both forms block the
 * over-long prefix read; the choice between them is pinned there, not by the prefix pin.
 */
const ASSIGNMENT_GAP_AND_VALUE_IN_QUOTED_SPAN = new RegExp(
    `(?:['"]?\\s*|[ \\t\\w.-]{0,20}[\\s'"]{0,3})(?:=|>|:{1,3}=|\\|\\||:|=>|\\?=|,)(?:` +
        `(?=['"\\x60\\s=]{0,4}['"\\x60])['"\\x60\\s=]{1,5}(?<quoted>[^'"\\x60\\s;\\\\]{16,150}|[A-Za-z0-9][A-Za-z0-9+/]{15,}={0,3})(?=['"\\x60\\s;]|\\\\[nr]|$)` +
        `|[\\s=]*(?<bare>[A-Za-z0-9+/_=.-]{16,150}|[A-Za-z0-9][A-Za-z0-9+/]{15,}={0,3})(?=['"\\x60\\s;]|\\\\[nr]|$)(?<after>[^\\s]?))`,
    'iyu'
);

/** One character of the continuation between a secret-named key and its operator. */
const KEY_CONTINUATION = /[\w.-]/u;

/**
 * One character that makes a key name mid-token on its left edge: a letter or a digit, so
 * `Token` inside `sessionToken` is interior, but `_` still separates — `api_secret` is the
 * dominant snake_case secret-naming vocabulary, not a token embedding.
 */
const LETTER_OR_DIGIT = /[A-Za-z0-9]/u;

/**
 * The first character of an operator that breaks the scanner's first match at a rejected value's
 * end. `=` rides the scanner's `[\w.=-]` secret run, and a quote, whitespace, or `;` terminates
 * the match, so either form keeps the first match standing and the span is never re-read. A `:`,
 * `,`, `>`, `|`, or `?` is neither a secret-run character nor a terminator: the match fails
 * there, and the scanner re-matches from inside the run with no left boundary on the key. A
 * glued `=>` breaks the match one character later — the run absorbs the `=`, and the `>` is
 * again neither — so that pair is recognised at the call site alongside this class.
 */
const FIRST_MATCH_BREAKING_OPERATOR = /[:>|?,]/u;

/** A vendor-shaped key, given as the parts its prefix is assembled from and the shape that follows. */
type VendorShape = {
    readonly reason: string;
    readonly parts: readonly string[];
    readonly tail: string;
    readonly flags: 'iu' | 'u';
};

/**
 * The value-complete families the pinned scanner cannot express as a mechanical literal prefix, kept
 * by hand so their behaviour is unchanged. Each is either a prefix too short to derive (JWT, Twilio,
 * SendGrid, Hugging Face), an alternation with a character class (AWS), a top-level alternation in
 * the tail (OpenAI), or a family with no rule in the pinned config at all (Google OAuth `GOCSPX`,
 * the Twilio account identifier `AC`). A prefix alone is not a credential here, so each carries the
 * length that makes it one.
 */
const RETAINED_VENDOR_SHAPES: readonly VendorShape[] = [
    { reason: 'a GitHub token', parts: ['gh', 'p_'], tail: '[A-Za-z0-9]{20,}', flags: 'u' },
    { reason: 'a fine-grained GitHub token', parts: ['github', '_pat_'], tail: '[A-Za-z0-9_]{20,}', flags: 'u' },
    { reason: 'an AWS access key id', parts: ['A', 'K', 'IA'], tail: '[0-9A-Z]{16}', flags: 'u' },
    { reason: 'an AWS access key id', parts: ['A', 'S', 'IA'], tail: '[0-9A-Z]{16}', flags: 'u' },
    { reason: 'an AWS access key id', parts: ['A', 'B', 'IA'], tail: '[0-9A-Z]{16}', flags: 'u' },
    { reason: 'an AWS access key id', parts: ['A', 'C', 'CA'], tail: '[0-9A-Z]{16}', flags: 'u' },
    { reason: 'an AWS access key id', parts: ['A', '3', 'T', '[A-Z0-9]'], tail: '[0-9A-Z]{16}', flags: 'u' },
    {
        reason: 'a JSON web token',
        parts: ['ey', 'J'],
        tail: '[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
        flags: 'u',
    },
    { reason: 'an OpenAI-style secret key', parts: ['s', 'k-'], tail: '[A-Za-z0-9_-]{20,}', flags: 'u' },
    { reason: 'an Anthropic-style secret key', parts: ['s', 'k-', 'a', 'nt-'], tail: '[A-Za-z0-9_-]{20,}', flags: 'u' },
    { reason: 'a Google API key', parts: ['AI', 'za'], tail: '[0-9A-Za-z_-]{35}', flags: 'u' },
    { reason: 'a Google OAuth client secret', parts: ['GO', 'CS', 'PX-'], tail: '[A-Za-z0-9_-]{10,}', flags: 'u' },
    {
        reason: 'a Stripe secret key',
        parts: ['(?:s', 'k_|r', 'k_)(?:te', 'st_|li', 've_|pr', 'od_)'],
        tail: '[0-9A-Za-z]{10,}',
        flags: 'u',
    },
    { reason: 'a Slack token', parts: ['xo', 'x'], tail: '[baprs]-[0-9A-Za-z-]{10,}', flags: 'u' },
    {
        reason: 'a Twilio account identifier paired with a secret',
        parts: ['A', 'C'],
        tail: '[0-9a-f]{32}\\b',
        flags: 'u',
    },
    { reason: 'a SendGrid API key', parts: ['S', 'G\\.'], tail: '[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}', flags: 'u' },
    { reason: 'a GitLab personal access token', parts: ['gl', 'pa', 't-'], tail: '[A-Za-z0-9_-]{20,}', flags: 'u' },
    { reason: 'an npm access token', parts: ['np', 'm_'], tail: '[A-Za-z0-9]{30,}', flags: 'u' },
    { reason: 'a Hugging Face token', parts: ['h', 'f_'], tail: '[A-Za-z0-9]{30,}', flags: 'u' },
];

/** Every vendor shape the screen withholds: the retained families, then the generated table. */
const VENDOR_SHAPES: readonly VendorShape[] = [...RETAINED_VENDOR_SHAPES, ...EGRESS_VENDOR_SHAPES];

/** A value that reads as a placeholder rather than as a credential. */
const PLACEHOLDER_VALUE = /^(?:secret|password|passwd|token|apikey|api[_-]?key|xxx+|\*+|\.\.\.)$/iu;

/**
 * A filesystem path: a leading marker (`/`, `./`, `../`, `~/`, or a Windows drive letter) followed
 * by at least two name segments separated by `/` or `\`. A run of name-characters with `/`
 * separators and no `+` or `=` is indistinguishable from a mixed-case path and is admitted — the
 * deliberate trade, since refusing mixed-case paths would refuse `/Users/Jose/…` and `C:\Users\…`,
 * the expensive direction. What stays withheld: base64url never contains `/` at all; any run
 * carrying `+` or `=` fails the name-character segments; and a credential that begins with `/`
 * requires a first byte at or above 0xFC, which no encoded ASCII secret can produce.
 */
const FILESYSTEM_PATH = /^(?:\/|\.\.?\/|~\/|[A-Za-z]:[\\/])[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+$/u;

/**
 * Whether a candidate value is shaped like a credential rather than like ordinary code.
 *
 * The general rule cannot separate an assigned secret from an assigned identifier by the key's name:
 * `token: usage.actualInputTokens` and `token: "AbCd…"` share a shape. The value separates them. A
 * code expression continues after the run, carries structural punctuation or a member access, is a
 * bare mixed-case identifier, or is SCREAMING_SNAKE naming for an environment variable; a sentence
 * or a placeholder is not a credential either. Requiring all of that is what keeps this rule from
 * refusing to send the module that implements it, which is what the previous revision did to
 * thirteen of this change's paths.
 *
 * The SCREAMING_SNAKE rejection must stay for identifiers, but it is what admitted an all-uppercase
 * key id assigned to a secret-named variable: an opaque all-uppercase run with letters and digits
 * matched the `[A-Z][A-Z0-9_]*` name shape even though it is an opaque value, not a name. A run that
 * carries both letters and digits and no underscore separator is therefore credential-shaped even
 * when uppercase; an all-uppercase run without digits, or with an underscore, remains a name.
 *
 * A *bare* mixed-case alphabetic run — letters only, no digits, no separator — is treated as a
 * reference (an identifier such as `workletSynthDevice` or `CallbackUndoEntry`), not as key
 * material, in the same way a dotted member access already is; a quoted run is a value by
 * construction and is never treated as a reference. The trade is only the bare half: a bare token is
 * a literal in env, shell, INI and TOML files, and a mixed-case passphrase, so those stop reaching
 * the general rule. The loss is length-dependent for base64-shaped letter tokens — about 3.6% of
 * 16-character tokens, 0.7% of 24, 0.13% of 32 — not a flat "one to four percent" of everything.
 */
function looksLikeCredentialValue(value: string, after: string, quoted: boolean): boolean {
    if (after !== '' && /[\w(.[?:]/.test(after)) {
        // The run was cut short by an expression, a call, an index, or a longer identifier.
        return false;
    }
    if (/[(),;{}[\]<>?!$|&*\\]/.test(value) || /[\s…`]/.test(value)) {
        return false;
    }
    if (/\.[A-Za-z_$]/.test(value)) {
        return false;
    }
    if (FILESYSTEM_PATH.test(value)) {
        return false;
    }
    if (!quoted && /^[A-Za-z]+$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value)) {
        return false;
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(value) && (!/[0-9]/.test(value) || value.includes('_'))) {
        return false;
    }
    return !PLACEHOLDER_VALUE.test(value);
}

/** Literal scheme values do not inherit assignment-expression exemptions. */
function hasOpaqueBearerValue(text: string): boolean {
    // Match every candidate with a fresh iterator: a benign first example cannot hide later material.
    // Explicit headers bind colon/assignment values or quoted comma pairs (setters and tuples),
    // including their JSON-escaped source strings, at RFC 6750's one-character minimum.
    // Unqualified scheme text retains the generic assignment screen's 16-character opaque-value floor.
    for (const match of text.matchAll(
        /\bauthorization(?:(?:\\*["'\x60])?\s*[:=]\s*(?:\\*["'\x60])?|\\*["'\x60]\s*,\s*\\*["'\x60])bearer[ \t]+([A-Za-z0-9+/_~.-]+=*)|\bbearer[ \t]+([A-Za-z0-9+/_=.~-]{16,})/giu
    )) {
        const value = match[1] ?? match[2]!;
        if (PLACEHOLDER_VALUE.test(value) || /^[A-Z][A-Z0-9_]*_PLACEHOLDER$/u.test(value)) {
            continue;
        }
        // Only this explicit documentation descriptor receives the prose-context exemption.
        if (
            match[1] === undefined &&
            value === 'credential-shaped' &&
            /\b[A-Za-z]+[ \t]+$/u.test(text.slice(0, match.index)) &&
            /^[ \t]+[A-Za-z]+\b/u.test(text.slice(match.index + match[0].length))
        ) {
            continue;
        }
        return true;
    }
    return false;
}

/**
 * The gap, operator, and value anchored at `stop`, when they can form a genuine second
 * assignment for a rejected value ending at `matchEnd`.
 *
 * An operator strictly inside a rejected *bare* span pairs the candidate key with text the
 * rejected match already read as its value, so it is fabricated — unless the probed value is
 * quoted, because a quote cannot appear inside the unquoted run: the longest operator is four
 * characters (`:::=`, from `:{1,3}=`) and the quoted branch's opening window reaches a quote at
 * most four characters past the operator, so a quote reaching past the span is reachable only
 * within eight characters of its end. Anything else inside the span is the bare class's `+`,
 * `/`, or `=`, where no gap or operator can start. At or past the span's end the right half is
 * genuine by position, and a match whose value ends inside the span is fabricated — the bare
 * run cannot cross the span's end, so that test needs no lookahead of its own.
 *
 * A rejected *quoted* span reads differently: its content class admits operators and dotted
 * names, so an operator deep inside it is genuine text rather than absorbed bare-run material,
 * and the eight-character window does not apply. The span's end is its terminator — the closing
 * quote, left unconsumed, or an interior space — a boundary the interior assignment has no
 * fabricated relationship with, so the reach-past-`matchEnd` test does not apply either:
 * `'runtime.sessionToken2:<opaque>'` ends at the quote, exactly at `matchEnd`. The operator
 * pre-check still holds, because no gap or operator can start at a non-operator character in
 * either span kind. And the probe mirrors the scanner's two-branch value reach
 * (`ASSIGNMENT_GAP_AND_VALUE_IN_QUOTED_SPAN`): a `[\w.=-]` run past the first branch's
 * 150-character bound is silent on the scanner — no terminator is reachable from inside it —
 * while a pure base64-alphabet run rides the unbounded second branch and flags at any length,
 * so the probe bounds the first and mirrors the second. One stop's scan still ends at the bound
 * or the next run boundary instead of re-reading the remaining tail — the wholly unbounded form
 * cost O(stops x tail) on an operator-dense quoted blob.
 */
function probeAssignmentAt(text: string, stop: number, matchEnd: number, quotedSpan: boolean): RegExpExecArray | null {
    const insideSpan = stop < matchEnd;
    if (insideSpan && !/[\s'"\x60]/.test(text.charAt(stop))) {
        const operatorish =
            text[stop] === '=' ||
            text[stop] === '>' ||
            text[stop] === ':' ||
            text[stop] === '|' ||
            text[stop] === '?' ||
            text[stop] === ',';
        if (!operatorish || (!quotedSpan && matchEnd - stop > 8)) {
            return null;
        }
    }
    const probePattern = quotedSpan ? ASSIGNMENT_GAP_AND_VALUE_IN_QUOTED_SPAN : ASSIGNMENT_GAP_AND_VALUE;
    probePattern.lastIndex = stop;
    const match = probePattern.exec(text);
    if (match === null || !insideSpan || quotedSpan) {
        return match;
    }
    const after = match.groups?.quoted === undefined ? (match.groups?.after ?? '') : '';
    return stop + match[0].length - after.length > matchEnd ? match : null;
}

/** The value a probe matched, with the bare class's trailing boundary character. */
function probeValue(match: RegExpExecArray): { quoted: boolean; value: string; after: string } {
    const quotedValue = match.groups?.quoted;
    if (quotedValue !== undefined) {
        return { quoted: true, value: quotedValue, after: '' };
    }
    return { quoted: false, value: match.groups?.bare ?? '', after: match.groups?.after ?? '' };
}

/**
 * Whether a key found inside the rejected value's span starts a genuine assignment there. A
 * quoted value reads as a value by construction, so any interior key counts. For a bare value
 * the answer follows the probed operator, mirroring the scanner's shadowing: while the operator
 * keeps the scanner's first match standing — a space-`=` form, riding the secret run or sitting
 * past the consumed terminator — the key must still start strictly inside the span after a
 * character that is neither a letter nor a digit, because the scanner never re-reads the span
 * and a mid-token key is the screen's own fabrication there. Once the operator breaks that
 * match — a glued `=>` included, whose `>` fails the match one character after the run
 * absorbed the `=` — the scanner re-matches from inside the run with no left boundary, so any
 * interior key counts — mid-token (`Token` in `sessionToken2`) or spanning the value's own
 * start (`credential` in `credentialABCDEFGH:`).
 */
function genuineInteriorKey(
    text: string,
    keyIndex: number,
    valueStart: number,
    quoted: boolean,
    probeBreaksFirstMatch: boolean
): boolean {
    if (quoted || probeBreaksFirstMatch) {
        return true;
    }
    return keyIndex > valueStart && !LETTER_OR_DIGIT.test(text.charAt(keyIndex - 1));
}

/**
 * The reason a rejected assignment still hides a genuine second assignment inside its value
 * span, if it does.
 *
 * Resuming the whole rule at the rejected value's start (#4872) found that assignment, but it
 * re-consumed the remaining tail once per rejected match — quadratic on a one-line minified
 * hunk — and it re-read the value's interior as key material, so
 * `token = credentials.sessionToken = runtimeSessionToken2` was withheld on the `Token` inside
 * `sessionToken` while the parent and the pinned scanner stayed silent. This scan keeps the
 * rescan and bounds it:
 *
 * - Only the rejected value's own span is searched for keys, one run of `[\w.-]` continuation
 *   characters probed once, and a position that yields no operator ends the search for every
 *   key before it — no key name crosses such a position — so the scan stays linear in the span.
 * - For a rejected bare value the operator and value must reach past the rejected match's end
 *   (`probeAssignmentAt`), so the second operator of the `session.token=` chain — absorbed by
 *   the bare value class inside the span — is not re-read as an assignment. The same absorption
 *   admits a packed `token = A1b2….secret=<opaque>`: no gap around the second operator leaves
 *   the whole run one bare value, so no interior pair ever forms. The parent admitted those
 *   lines too. The pinned scanner flags the packed run through its entropy gate (5.27 against
 *   the 3.5 floor) and silences the benign chain through its stopword allowlist — the chain's
 *   entropy is above the floor too at 3.57, and each of `session`, `runtime`, `token` alone
 *   silences a de-stopworded variant that otherwise flags at 4.35 — and neither mechanism is
 *   modelled here (#4579). A rejected quoted value's interior is real text instead, terminated
 *   by the closing quote or an interior space, so a genuine assignment inside it is recognised
 *   wherever it ends — up to the scanner's own value reach: a `[\w.=-]` run past the pinned
 *   rule's 150-character first-branch bound is silent on the scanner, a pure base64-alphabet
 *   run rides the rule's unbounded second branch, and the quoted-span probe mirrors both.
 * - A bare value's interior key follows the probed operator, mirroring the scanner's shadowing.
 *   The scanner matches leftmost and consumes its terminator, so a space-`=` first assignment
 *   shadows a second one: the operator rides the `[\w.=-]` secret run or sits past the consumed
 *   terminator, and the span is never re-read — the pinned benign chains
 *   (`token = credentials.sessionToken = runtimeSessionToken2`) stay silent. For those forms the
 *   key must start strictly inside the span after a
 *   character that is neither a letter nor a digit — the `.secret` of the dotted #4872 run, or
 *   the `_secret` of snake_case (`api_secret`), since `_` separates names rather than embedding
 *   them. That leaves out the value-spanning key (`credential` in `credentials.sessionToken = …`,
 *   at the value's own start) and mid-token keys (`Token` in `sessionToken`), which pair a
 *   fabricated operator with an identifier-shaped value. But an operator that is neither a
 *   secret-run character nor a terminator — `:`, `,`, `>`, `|`, `?` — breaks the scanner's
 *   first match, which then re-matches from inside the run and flags the interior assignment
 *   with no left boundary: the mid-token `Token` of `runtime.sessionToken2: <opaque>` counts,
 *   and so does a key spanning the value's own start. A glued `=>` breaks the match one
 *   character later — the `=` rides the run and the `>` fails it — so
 *   `runtime.sessionToken2=> <opaque>` counts too. A quoted run reads as a value by
 *   construction, so a quoted value counts from any interior key either way, word-embedded or
 *   not — `token = xx.aSecretLongerName = '<value>'` stays withheld.
 */
function rejectedValueAssignmentReason(
    text: string,
    valueStart: number,
    matchEnd: number,
    quotedSpan: boolean
): string | undefined {
    let searchFrom = valueStart;
    // The probe past a candidate key is shared by every candidate whose continuation ends at
    // the same stop, so it — and the value judgment, which depends only on the probe — is
    // computed once per `[\w.-]` run rather than once per key.
    let probedFrom = -1;
    let probeStop = -1;
    let probeMatch: RegExpExecArray | null = null;
    let probeQuoted = false;
    let probeCredentialShaped = false;
    let probeBreaksFirstMatch = false;
    for (;;) {
        SECRET_KEY_SEARCH.lastIndex = searchFrom;
        const key = SECRET_KEY_SEARCH.exec(text);
        if (key === null || key.index >= matchEnd) {
            return undefined;
        }
        const keyEnd = key.index + key[0].length;
        if (keyEnd > matchEnd) {
            return undefined;
        }
        if (keyEnd < probedFrom || keyEnd > probeStop) {
            probedFrom = keyEnd;
            probeStop = keyEnd;
            while (probeStop < matchEnd && KEY_CONTINUATION.test(text.charAt(probeStop))) {
                probeStop += 1;
            }
            probeMatch = probeAssignmentAt(text, probeStop, matchEnd, quotedSpan);
            probeBreaksFirstMatch =
                probeStop < matchEnd &&
                (FIRST_MATCH_BREAKING_OPERATOR.test(text.charAt(probeStop)) ||
                    (text.charAt(probeStop) === '=' && text.charAt(probeStop + 1) === '>'));
            if (probeMatch === null) {
                probeQuoted = false;
                probeCredentialShaped = false;
            } else {
                const probed = probeValue(probeMatch);
                probeQuoted = probed.quoted;
                probeCredentialShaped = looksLikeCredentialValue(probed.value, probed.after, probed.quoted);
            }
        }
        if (
            probeCredentialShaped &&
            genuineInteriorKey(text, key.index, valueStart, probeQuoted, probeBreaksFirstMatch)
        ) {
            return 'a secret-named key assigned a credential-shaped value';
        }
        searchFrom = probeMatch === null ? probeStop + 1 : key.index + 1;
    }
}

/**
 * The first secret-named assignment whose value is shaped like a credential, if any.
 *
 * A rejected match still consumed its whole span: in `token = A1b2….secret = '…'` the dotted run
 * is read as a member access, and resuming past it never evaluated the assignment that follows
 * on the same line, so the pinned scanner flagged the line while the screen admitted it
 * (#4872). A rejection therefore probes the rejected value's span for one more genuine
 * assignment (`rejectedValueAssignmentReason`) and resumes the scan at the rejected match's
 * end. The resumption point always sits past the rejected match's start, because the key name
 * and the operator are at least four characters between them, so rejected match starts
 * strictly increase and the scan terminates; each accepted match returns, and an exhausted scan
 * ends the loop.
 */
function secretAssignmentReason(text: string): string | undefined {
    SECRET_ASSIGNMENT.lastIndex = 0;
    let match = SECRET_ASSIGNMENT.exec(text);
    while (match !== null) {
        const quoted = match.groups?.quoted !== undefined;
        const value = match.groups?.quoted ?? match.groups?.bare;
        if (value !== undefined) {
            const after = quoted ? '' : (match.groups?.after ?? '');
            if (looksLikeCredentialValue(value, after, quoted)) {
                return 'a secret-named key assigned a credential-shaped value';
            }
            const matchEnd = match.index + match[0].length;
            const reason = rejectedValueAssignmentReason(
                text,
                matchEnd - value.length - after.length,
                matchEnd,
                quoted
            );
            if (reason !== undefined) {
                return reason;
            }
            SECRET_ASSIGNMENT.lastIndex = matchEnd;
        }
        match = SECRET_ASSIGNMENT.exec(text);
    }
    return undefined;
}

/** Shapes withheld from egress but not from publication, which must not become stricter than it was. */
type EgressShape = {
    readonly reason: string;
    readonly pattern: RegExp;
    /** A shape whose pattern can match ordinary code validates the candidate before refusing. */
    readonly validate?: (match: RegExpExecArray) => boolean;
};

/** The BEGIN header of an armored block, tolerant of the dashes and inner label of every PEM variant. */
const ARMOR_HEADER = String.raw`-{4,5} ?BEGIN [A-Z0-9 ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)? ?-{4,5}`;

/** The matching closing footer: the anchor that proves a reflowed block is a block, not prose. */
const ARMOR_FOOTER = String.raw`-{4,5} ?END [A-Z0-9 ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)? ?-{4,5}`;

/**
 * Envelope lines between the header and the body: `Proc-Type` and `DEK-Info` on a passphrase-encrypted
 * block, a `Version:` or `Comment:` line, or a blank line. The pinned scanner's private-key rule spans
 * them all, so none may break the match.
 *
 * Each line has exactly one whitespace consumer. The optional `Word: value` group's `[^\r\n]*` already
 * swallows trailing whitespace when it matches, and the leading `[ \t]*` is the only consumer of a
 * whitespace-only line. A second trailing `[ \t]*` separated from it only by the optional group gave
 * every blank line one backtracking path per leading space, and the outer `*` multiplied those across
 * lines, so a lone header followed by whitespace-padded blank lines matched in exponential time over an
 * input it can never match.
 */
const ARMOR_ENVELOPE = String.raw`(?:[ \t]*(?:[A-Za-z][A-Za-z0-9-]*:[^\r\n]*)?\r?\n)*`;

/** One base64 body line, possibly indented, so a body reflowed into short lines still matches. */
const ARMOR_BODY_LINE = String.raw`[ \t]*[A-Za-z0-9+/=]+[ \t]*\r?\n`;

const EGRESS_ONLY_SHAPES: readonly EgressShape[] = [
    // An armored private key: the BEGIN header of a PEM block, such as a PKCS#8 or OpenSSH private
    // key block, followed by base64 key material and a closing footer. `SECRET_KEY_NAME` matches only
    // a `key = value` assignment, so a block passes untouched and would be submitted to the provider.
    // Egress requires each shape to carry a value, so the header alone is not enough: a documentation
    // sentence that quotes the header carries no key material and must not be withheld.
    //
    // The shape keys on the block, not on one line's length. A closing footer identifies a block whose
    // body was reflowed into lines shorter than any single-line floor, and the body may begin on the
    // header's own line rather than after a break, so both are caught. Without a footer the body must
    // still be a run of real body length: a PEM body line is sixty-four base64 characters — the length
    // the pinned scanner's own body requirement uses — and a twenty-four-character placeholder under a
    // header is a fake block that must not be withheld.
    {
        reason: 'an armored private key',
        pattern: new RegExp(
            String.raw`${ARMOR_HEADER}(?:[ \t]*\r?\n${ARMOR_ENVELOPE})?(?:(?:${ARMOR_BODY_LINE})+[ \t]*${ARMOR_FOOTER}|[ \t]*[A-Za-z0-9+/=]{64,})`,
            'u'
        ),
    },
    // A secret in a query parameter: `?password=…`, `&access_token=…`, `&sig=…`.
    {
        reason: 'a secret carried in a query parameter',
        pattern:
            /[?&](?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|sig|signature)=(?![^&\s"']*(?:…|`|\.\.\.))[^&\s"']{8,}/iu,
    },
    // A URI with embedded credentials: scheme://user:secret@host, user optional (`redis://:pass@h`).
    {
        reason: 'a connection string with embedded credentials',
        // A placeholder where the secret belongs is documentation, not a credential.
        pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:(?!(?:secret|password|passwd|token|xxx+)@)[^\s@/${}]{6,}@/iu,
    },
    // A key-value connection string: a host key and a secret key in the same statement.
    {
        reason: 'a key-value connection string with a secret',
        // Proximity alone is not a secret: two unrelated constants in one file are not a connection
        // string, so the value has to be credential-shaped like every other assignment.
        pattern: new RegExp(
            `(?:server|host|data source|addr|endpoint)\\s*=\\s*[^;]{1,80};[\\s\\S]{0,120}?${SECRET_KEY_NAME.source}\\w*\\s*=\\s*(?<bare>[A-Za-z0-9+/_=.-]{8,})(?<after>[^\\s]?)`,
            'iu'
        ),
        validate: (match: RegExpExecArray) =>
            looksLikeCredentialValue(match.groups?.bare ?? '', match.groups?.after ?? '', false),
    },
    ...VENDOR_SHAPES.map(({ reason, parts, tail, flags }) => ({
        reason,
        pattern: new RegExp(`\\b${parts.join('')}${tail}`, flags),
    })),
];

/** The first shape in `text` that must not leave the machine, or `undefined` when none is found. */
export function sensitiveContentReason(text: string): string | undefined {
    // Specific shapes first: a recognised vendor key, connection string, query parameter, or
    // armored block names itself. The general secret-named assignment rule is the fallback for an
    // unrecognised credential-shaped value, so a vendor-shaped value never loses its specific name.
    for (const shape of EGRESS_ONLY_SHAPES) {
        const match = shape.pattern.exec(text);
        if (match !== null && (shape.validate === undefined || shape.validate(match))) {
            return shape.reason;
        }
    }
    if (hasOpaqueBearerValue(text)) {
        return 'an opaque bearer credential';
    }
    return secretAssignmentReason(text);
}
