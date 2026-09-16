import { type RedactedText } from '../../models/AgentRunTelemetry';

const REDACTION_PLACEHOLDER = '[redacted]';

/**
 * Credential shapes replaced in any text a diagnostics record carries, in the
 * order they are applied. Order is part of the contract: `Bearer <token>` and
 * `api_key=<value>` keep their label and run first, so the encoded-run pattern
 * below cannot also match the value they already replaced and count it twice.
 *
 * The final pattern is base64url's alphabet, which contains hexadecimal's, so
 * one run covers both a hashed and an encoded credential. Thirty-two characters
 * is the shortest such run a credential digest produces; ordinary prose words
 * are far shorter.
 */
const SECRET_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
    { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/g, replacement: `Bearer ${REDACTION_PLACEHOLDER}` },
    { pattern: /\b(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, replacement: `$1${REDACTION_PLACEHOLDER}` },
    { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replacement: REDACTION_PLACEHOLDER },
    { pattern: /[A-Za-z0-9_-]{32,}/g, replacement: REDACTION_PLACEHOLDER },
];

/** Replace every credential shape in `text` and report how many were replaced. */
export function redactSecrets(text: string): { text: string; redactedCount: number } {
    let redacted = text;
    let redactedCount = 0;

    for (const { pattern, replacement } of SECRET_PATTERNS) {
        const matches = redacted.match(pattern);
        if (matches === null) {
            continue;
        }
        redactedCount += matches.length;
        redacted = redacted.replace(pattern, replacement);
    }

    return { text: redacted, redactedCount };
}

/** Carry only the length of `text`, so nothing of its content is disclosed. */
export function withholdText(text: string): RedactedText {
    return { kind: 'withheld', length: text.length };
}

/** Carry `text` with its credential shapes replaced. */
export function redactText(text: string): RedactedText {
    const { text: redacted, redactedCount } = redactSecrets(text);
    return { kind: 'text', text: redacted, secretsRedacted: redactedCount };
}
