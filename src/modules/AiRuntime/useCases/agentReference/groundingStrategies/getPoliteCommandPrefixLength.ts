/** The polite carrier a command may open on: "could you please", then at most one "please". */
const POLITE_COMMAND_PREFIX = /^\s*(?:(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+)?(?:please\s+)?/iu;

/** How many characters of `text` its polite carrier takes, leading whitespace included. */
export function getPoliteCommandPrefixLength(text: string): number {
    return POLITE_COMMAND_PREFIX.exec(text)?.[0].length ?? 0;
}
