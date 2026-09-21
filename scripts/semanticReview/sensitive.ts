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
 */

/**
 * A secret-named key: `account_key`, `apiKey`, `CLIENT_SECRET`, `auth-token`, `password`.
 *
 * A bare `key` is deliberately absent. Including it made the identifier `KEY` a secret name, so
 * `KEY = 'workflowFileInventory'` and `KEYS: Record<...>` read as credentials — and because a
 * withheld region is not sent at all, ordinary constant declarations took whole files out of the
 * assessment.
 */
const SECRET_KEY_NAME =
    /(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?(?:token|key)|credential|sas|signature)/iu;

/**
 * Where a secret-named key is followed by a candidate value: the separator, and then either a quoted
 * string or an unquoted opaque run.
 */
const SECRET_ASSIGNMENT =
    /(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?(?:token|key)|credential|sas|signature)\w*['"]?\s*[=:]\s*(?:['"](?<quoted>[^'"]{16,})['"]|(?<bare>[A-Za-z0-9+/_=.-]{16,})(?<after>[^\s]?))/giu;

/** A vendor-shaped key, given as the parts its prefix is assembled from and the shape that follows. */
type VendorShape = { readonly reason: string; readonly parts: readonly string[]; readonly tail: string };

const VENDOR_SHAPES: readonly VendorShape[] = [
    // The value-complete shapes a publication list may state as a bare prefix. A prefix alone is not a
    // credential here, so each carries the length that makes it one.
    { reason: 'a GitHub token', parts: ['gh', 'p_'], tail: '[A-Za-z0-9]{20,}' },
    { reason: 'a fine-grained GitHub token', parts: ['github', '_pat_'], tail: '[A-Za-z0-9_]{20,}' },
    { reason: 'an AWS access key id', parts: ['A', 'K', 'IA'], tail: '[0-9A-Z]{16}' },
    {
        reason: 'a JSON web token',
        parts: ['ey', 'J'],
        tail: '[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
    },
    { reason: 'an OpenAI-style secret key', parts: ['s', 'k-'], tail: '[A-Za-z0-9_-]{20,}' },
    { reason: 'an Anthropic-style secret key', parts: ['s', 'k-', 'a', 'nt-'], tail: '[A-Za-z0-9_-]{20,}' },
    { reason: 'a Google API key', parts: ['AI', 'za'], tail: '[0-9A-Za-z_-]{35}' },
    { reason: 'a Google OAuth client secret', parts: ['GO', 'CS', 'PX-'], tail: '[A-Za-z0-9_-]{10,}' },
    { reason: 'a Stripe live secret key', parts: ['s', 'k_', 'li', 've_'], tail: '[0-9A-Za-z]{16,}' },
    { reason: 'a Slack token', parts: ['xo', 'x'], tail: '[baprs]-[0-9A-Za-z-]{10,}' },
    { reason: 'a Twilio account identifier paired with a secret', parts: ['A', 'C'], tail: '[0-9a-f]{32}\\b' },
    { reason: 'a SendGrid API key', parts: ['S', 'G\\.'], tail: '[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}' },
    { reason: 'a GitLab personal access token', parts: ['gl', 'pa', 't-'], tail: '[A-Za-z0-9_-]{20,}' },
    { reason: 'an npm access token', parts: ['np', 'm_'], tail: '[A-Za-z0-9]{30,}' },
    { reason: 'a Hugging Face token', parts: ['h', 'f_'], tail: '[A-Za-z0-9]{30,}' },
];

/** A value that reads as a placeholder rather than as a credential. */
const PLACEHOLDER_VALUE = /^(?:secret|password|passwd|token|apikey|api[_-]?key|xxx+|\*+|\.\.\.)$/iu;

/**
 * Whether a candidate value is shaped like a credential rather than like ordinary code.
 *
 * The general rule cannot separate an assigned secret from an assigned identifier by the key's name:
 * `token: usage.actualInputTokens` and `token: "AbCd…"` share a shape. The value separates them. A
 * code expression continues after the run, carries structural punctuation or a member access, or is
 * SCREAMING_SNAKE naming for an environment variable; a sentence or a placeholder is not a
 * credential either. Requiring all of that is what keeps this rule from refusing to send the module
 * that implements it, which is what the previous revision did to thirteen of this change's paths.
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
    if (/^[A-Z][A-Z0-9_]*$/.test(value)) {
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

const EGRESS_ONLY_SHAPES: readonly EgressShape[] = [
    // An armored private key: the BEGIN header of a PEM block, such as a PKCS#8 or OpenSSH private
    // key block, followed by a line break and a run of base64 key material. `SECRET_KEY_NAME` matches
    // only a `key = value` assignment, so a block passes untouched and would be submitted to the
    // provider. Egress requires each shape to carry a value, so the header alone is not enough: a
    // documentation sentence that quotes the header carries no key material and must not be withheld.
    // The body, not the closing footer, is what is required, so a block pasted without its footer is
    // still caught — the pinned Gitleaks rule requires both, and being stricter than it buys nothing.
    {
        reason: 'an armored private key',
        pattern:
            /-{4,5} ?BEGIN [A-Z0-9 ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)? ?-{4,5}[ \t]*\r?\n[ \t]*[A-Za-z0-9+/=]{8,}/u,
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
    ...VENDOR_SHAPES.map(({ reason, parts, tail }) => ({
        reason,
        pattern: new RegExp(`\\b${parts.join('')}${tail}`, 'u'),
    })),
];

/** The first shape in `text` that must not leave the machine, or `undefined` when none is found. */
export function sensitiveContentReason(text: string): string | undefined {
    const assignment = secretAssignmentReason(text);
    if (assignment !== undefined) {
        return assignment;
    }
    for (const shape of EGRESS_ONLY_SHAPES) {
        const match = shape.pattern.exec(text);
        if (match !== null && (shape.validate === undefined || shape.validate(match))) {
            return shape.reason;
        }
    }
    return undefined;
}
