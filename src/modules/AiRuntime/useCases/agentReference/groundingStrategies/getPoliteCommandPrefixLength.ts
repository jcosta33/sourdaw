/**
 * The polite carrier a command may open on, as a pattern source: "could you please" or "I'd like you to",
 * then at most one "please" ("could you please please set" reads, "please please set" does not).
 */
export const POLITE_COMMAND_PREFIX_SOURCE = String.raw`^\s*(?:(?:please\s+)?(?:(?:can|could|would)\s+you|i(?:['’]d|\s+would)\s+like\s+you\s+to)(?:\s+please)?\s+)?(?:please\s+)?`;

const POLITE_COMMAND_PREFIX = new RegExp(POLITE_COMMAND_PREFIX_SOURCE, 'iu');

/** How many characters of `text` its polite carrier takes, leading whitespace included. */
export function getPoliteCommandPrefixLength(text: string): number {
    return POLITE_COMMAND_PREFIX.exec(text)?.[0].length ?? 0;
}
