import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';

/** Any whitespace between a phrase's words: "louder or quieter". */
const SPACED = String.raw`\s+`;
/** Spaces or a hyphen between a phrase's words, for a compound written either way: "low end", "low-end". */
export const HYPHEN_OR_SPACE = String.raw`[\s-]+`;

/**
 * The one builder every constraint word list is read through: a closed list as one alternation, longest
 * first, so "louder or quieter" is one two-way phrase and never a bound on "louder", each phrase's words
 * joined by the separator, any whitespace unless the list's words may also be hyphenated.
 */
export function words(list: readonly string[], separator: string = SPACED): string {
    const phrases = list
        .toSorted((left, right) => right.length - left.length)
        .map((phrase) => phrase.split(' ').map(escapeRegExp).join(separator));
    return `(?:${phrases.join('|')})`;
}
