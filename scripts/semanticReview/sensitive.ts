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
 * A secret-named key: `account_key`, `apiKey`, `CLIENT_SECRET`, `auth-token`, `password`, plus the
 * vendor family names the scanner's keyword-proximity rules carry (`adafruit`, `datadog`, …).
 *
 * A bare `key` is deliberately absent. Including it made the identifier `KEY` a secret name, so
 * `KEY = 'workflowFileInventory'` and `KEYS: Record<...>` read as credentials — and because a
 * withheld region is not sent at all, ordinary constant declarations took whole files out of the
 * assessment. The same exclusion is applied to the generic words (`key`, `api`, `access`, …) the
 * scanner's own keyword lists contain; only the vendor family names are derived.
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
    'sas',
    'signature',
    ...VENDOR_KEY_NAMES,
].join('|');

const SECRET_KEY_NAME = new RegExp(`\\b(?:${SECRET_KEY_NAME_SOURCE})`, 'iu');

/**
 * Where a secret-named key is followed by a candidate value: the separator, and then either a quoted
 * string or an unquoted opaque run. The leading `\b` bounds the name on the left so a vendor name
 * such as `linear` cannot match inside `bilinear` or `etsy` inside a `Synth` identifier.
 */
const SECRET_ASSIGNMENT = new RegExp(
    `\\b(?:${SECRET_KEY_NAME_SOURCE})\\w*['"]?\\s*[=:]\\s*(?:['"](?<quoted>[^'"]{16,})['"]|(?<bare>[A-Za-z0-9+/_=.-]{16,})(?<after>[^\\s]?))`,
    'giu'
);

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
 * A bare mixed-case alphabetic value — letters only, no digits, no separator — is treated as a
 * reference to something (an identifier such as `workletSynthDevice` or `CallbackUndoEntry`), not as
 * key material, in the same way a dotted member access already is. This admits the trade that a
 * credential which is mixed-case letters only — no digits and no `+`/`=`/`-`/`_` — stops reaching
 * the general rule; vendor shapes still catch their own families, and roughly one to four percent
 * of letter-class tokens of that length fall in that set.
 */
function looksLikeCredentialValue(value: string, after: string): boolean {
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
    if (/^[A-Za-z]+$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value)) {
        return false;
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(value) && (!/[0-9]/.test(value) || value.includes('_'))) {
        return false;
    }
    return !PLACEHOLDER_VALUE.test(value);
}

/** The first secret-named assignment whose value is shaped like a credential, if any. */
function secretAssignmentReason(text: string): string | undefined {
    for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
        const value = match.groups?.quoted ?? match.groups?.bare;
        if (value === undefined) {
            continue;
        }
        const after = match.groups?.quoted === undefined ? (match.groups?.after ?? '') : '';
        if (looksLikeCredentialValue(value, after)) {
            return 'a secret-named key assigned a credential-shaped value';
        }
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
            looksLikeCredentialValue(match.groups?.bare ?? '', match.groups?.after ?? ''),
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
    return secretAssignmentReason(text);
}
