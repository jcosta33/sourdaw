import { type RedactedText } from '../../models/AgentRunTelemetry';

const REDACTION_PLACEHOLDER = '[redacted]';

/** The labels both labelled patterns recognise, held once so the two cannot drift apart. */
const LABEL_ALTERNATION =
    'api[_-]?key|apikey|x-api-key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|token|secret';

/**
 * One label, the quote that may close it as a JSON key, and its separator, kept
 * as group 1 so a replacement can put all three back.
 *
 * The lookbehind admits a label an underscore or a hyphen precedes and rejects
 * one a letter or a digit precedes. `\b` counts an underscore as an identifier
 * character, so it finds the label in neither `myapp_password` nor
 * `refresh_token`; a letter still precedes the label in `inputTokens`, which
 * both forms reject.
 */
const LABELLED_PREFIX = `(?<![A-Za-z0-9])((?:${LABEL_ALTERNATION})["']?\\s*[:=]\\s*)`;

/**
 * Credential shapes replaced in any text a diagnostics record carries, in the
 * order they are applied.
 *
 * The shapes are the ones a prompt or a provider error plausibly carries: an
 * `Authorization` header holding `Bearer` or `Basic` credentials, a labelled
 * key, token, secret or password assignment as it appears in a header line, a
 * query string or a JSON body, an AWS access key id, a provider `sk-` key, and
 * any long encoded run.
 *
 * Order is part of the contract: the labelled forms keep their label and run
 * first, so the encoded-run pattern below cannot also match a value they
 * already replaced and count it twice. A quoted labelled value is consumed to
 * its closing quote, so a space or a separator inside the quotes cannot end the
 * value early; that entry therefore runs before the unquoted one. The unquoted
 * value class excludes `&`, `[`, both quotes and the separators, so a query
 * string keeps its remaining parameters and the bracketed placeholder is never
 * matched again by a later pass.
 *
 * The final pattern is the base64 and base64url alphabets with optional
 * padding, so a slash or a plus inside a credential no longer splits it into
 * runs too short to match; that alphabet contains hexadecimal's, so one run
 * covers a hashed credential too. Thirty-two characters is the shortest such
 * run a credential digest produces; it also swallows a path segment or an
 * identifier of that length, an over-redaction accepted so a digest cannot slip
 * under the threshold.
 *
 * A credential outside these shapes passes through unchanged. A record
 * carrying redacted text therefore states that the text was screened for these
 * shapes, not that it holds no secret.
 */
const SECRET_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
    { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/g, replacement: `Bearer ${REDACTION_PLACEHOLDER}` },
    { pattern: /\bBasic\s+[A-Za-z0-9+/=_-]+/g, replacement: `Basic ${REDACTION_PLACEHOLDER}` },
    {
        pattern: new RegExp(`${LABELLED_PREFIX}(["'])[^"']*\\2`, 'gi'),
        replacement: `$1$2${REDACTION_PLACEHOLDER}$2`,
    },
    {
        pattern: new RegExp(`${LABELLED_PREFIX}[^\\s,;"'&\\[}]+`, 'gi'),
        replacement: `$1${REDACTION_PLACEHOLDER}`,
    },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTION_PLACEHOLDER },
    { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replacement: REDACTION_PLACEHOLDER },
    { pattern: /[A-Za-z0-9+/_-]{32,}={0,2}/g, replacement: REDACTION_PLACEHOLDER },
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
