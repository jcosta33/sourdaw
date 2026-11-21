/** The one normalizer every constraint reader reads a phrase through: lower case, single spaces, trimmed. */
export function normalizePhrase(phrase: string): string {
    return phrase.toLowerCase().replaceAll(/\s+/gu, ' ').trim();
}
