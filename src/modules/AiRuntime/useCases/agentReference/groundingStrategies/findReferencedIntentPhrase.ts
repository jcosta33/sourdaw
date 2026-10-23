import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

export type ReferencedIntentPhraseMatch = {
    /** Where the phrase starts in the clause's normalized text. */
    index: number;
    /** Where the phrase ends in the clause itself. */
    end: number;
};

/** The registry writes the project object a phrase acts on as this placeholder. */
const REFERENCE_PLACEHOLDER = '{reference}';

/** Spacing and punctuation, never a masked reference. */
const SEPARATOR = '[^\\p{L}\\p{N}□]+';

/** `maskProjectReferences.ts` writes each project reference as one run of mask glyphs. */
const MASKED_REFERENCE = `(?:(?:the|an|a)${SEPARATOR})?□+`;

/** A phrase that opens with the placeholder names its action only where the clause itself begins. */
const CLAUSE_START = '^\\s*(?:please\\s+)?';

const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';

const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

/** Registry phrases bound this; each compiles once. */
const compiledPhrases = new Map<string, RegExp>();

function compilePhrase(phrase: string): RegExp {
    const cached = compiledPhrases.get(phrase);
    if (cached) {
        return cached;
    }
    const words = phrase.split(' ').filter(Boolean);
    const body = words
        .map((word) => (word === REFERENCE_PLACEHOLDER ? MASKED_REFERENCE : escapeRegExp(word)))
        .join(SEPARATOR);
    const opening = words[0] === REFERENCE_PLACEHOLDER ? CLAUSE_START : WORD_BOUNDARY_BEFORE;
    const pattern = new RegExp(`${opening}(${body})${WORD_BOUNDARY_AFTER}`, 'diu');
    compiledPhrases.set(phrase, pattern);
    return pattern;
}

/**
 * The place a phrase naming its project object with `{reference}` occurs in a clause: "set {reference} to"
 * in "set □□□□□ to -6 dB". The placeholder is exactly one masked reference, optionally after an article,
 * so a clause whose reference is missing, doubled or split by other words names nothing.
 */
export function findReferencedIntentPhrase(text: string, phrase: string): ReferencedIntentPhraseMatch | null {
    const match = compilePhrase(phrase).exec(text);
    const span = match?.indices?.[1];
    if (!span) {
        return null;
    }
    const [start, end] = span;
    const normalizedPrefix = normalizePromptText(text.slice(0, start));
    return { index: normalizedPrefix.length === 0 ? 0 : normalizedPrefix.length + 1, end };
}
