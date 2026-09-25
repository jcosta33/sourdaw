/**
 * The published-evidence value-safety rules (#2999, spec #2995 AC-009), extracted from
 * `reviewDossier.ts` so every evidence-carrying module shares the one refusal set. Every value a
 * record persists is published evidence: single-line, trimmed, byte-bounded, and refused when it
 * carries a credential-shaped value, a private-key header, a JWT, a bearer token, or raw
 * session-transcript markers.
 */

import { fail } from './prContract.ts';

/** A persisted evidence field stays well under any channel's ceiling. */
export const REVIEW_EVIDENCE_FIELD_MAX_BYTES = 2_048;

/** A bearer credential is a token carrying a digit or non-dot symbol anywhere, or twenty-four characters. */
const BEARER_CREDENTIAL_PATTERN = /\bbearer\s+(?=[\w.~+/=-]*(?:[0-9_~+/=-]|[\w.~+/=-]{24}))/iu;
/** The conventional serialized chat roles, matched case-insensitively so a capitalised one is refused. */
const CHAT_ROLE_PATTERN = /"role"\s*:\s*"(?:assistant|user|system|tool|function|developer)"/iu;

/** Every shape publication refuses, whatever field carries it, with the reason it is refused. */
const UNSAFE_VALUE_SHAPES: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
    { reason: 'a GitHub token', pattern: /gh[pousr]_/u },
    { reason: 'a fine-grained GitHub token', pattern: /github_pat_/u },
    { reason: 'an AWS access key id', pattern: /A[KS]IA[0-9A-Z]{16}/u },
    { reason: 'a private key header', pattern: /-{4,5} ?BEGIN [A-Z0-9 ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)? ?-{4,5}/u },
    { reason: 'a JSON web token', pattern: /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u },
    // RFC 6750/7235 auth schemes are case-insensitive, so `bearer` is refused like `Bearer`. The
    // token shape separates a credential from the word in `bearer token`: a digit or one of `_~+/=-`
    // anywhere, or twenty-four token characters. A dot never qualifies
    // on its own and a trailing period is punctuation, so prose stands; an eight-letter word is
    // indistinguishable from a token.
    { reason: 'a bearer credential', pattern: BEARER_CREDENTIAL_PATTERN },
    // A serialized chat role is a transcript turn whichever role it names; the named set is the
    // conventional serialized roles, so prose that merely mentions a role never matches.
    { reason: 'a serialized chat turn', pattern: CHAT_ROLE_PATTERN },
    { reason: 'a transcript role prefix', pattern: /^(?:Human|Assistant|System):/mu },
    { reason: 'a session transcript marker', pattern: /⏺|<session/u },
];

function assertSafeEvidenceValue(label: string, index: number, value: string): void {
    if (value.trim() === '') {
        fail(`${label} value at index ${index} is blank`);
    }
    if (value !== value.trim()) {
        fail(`${label} value at index ${index} is not edge-trimmed`);
    }
    if (/[\r\n\u2028\u2029]/u.test(value)) {
        fail(`${label} value at index ${index} contains a line separator`);
    }
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > REVIEW_EVIDENCE_FIELD_MAX_BYTES) {
        fail(`${label} value at index ${index} exceeds ${REVIEW_EVIDENCE_FIELD_MAX_BYTES} bytes: ${bytes}`);
    }
    const unsafe = unsafeCredentialReason(value);
    if (unsafe !== undefined) {
        fail(`${label} value at index ${index} contains ${unsafe}`);
    }
}

/** The first unsafe shape a value contains, or `undefined`. Shared so a new egress path reuses this list. */
export function unsafeCredentialReason(value: string): string | undefined {
    return UNSAFE_VALUE_SHAPES.find(({ pattern }) => pattern.test(value))?.reason;
}

export function assertPublicationSafeEvidence(label: string, values: readonly string[]): void {
    for (const [index, value] of values.entries()) {
        assertSafeEvidenceValue(label, index, value);
    }
}
