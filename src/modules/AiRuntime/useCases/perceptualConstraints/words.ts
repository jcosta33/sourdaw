import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';

/**
 * The one builder every constraint word list is read through: a closed list as one alternation, longest
 * first, so "louder or quieter" is one two-way phrase and never a bound on "louder", each phrase's words
 * joined by any whitespace.
 */
export function words(list: readonly string[]): string {
    const phrases = list
        .toSorted((left, right) => right.length - left.length)
        .map((phrase) =>
            phrase
                .split(' ')
                .map(escapeRegExp)
                .join(String.raw`\s+`)
        );
    return `(?:${phrases.join('|')})`;
}
