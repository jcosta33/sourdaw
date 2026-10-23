import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

export type ReferencedIntentPhraseMatch = {
    /** Where the phrase starts in the clause's normalized text. */
    index: number;
    /** Where the reference the placeholder stands for sits in the clause itself. */
    slot: { start: number; end: number };
};

/** The registry writes the project object a phrase acts on as this placeholder. */
export const REFERENCE_PLACEHOLDER = '{reference}';

/** `maskProjectReferences.ts` writes each project reference as one run of mask glyphs. */
const MASKED_REFERENCE = '(?:the\\s+)?(□+)';

/** A signed decibel figure and its unit, the way `classifyPromptDecibelFigures.ts` reads one. */
const DECIBEL_FIGURE = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*d\\s?b';

/** The clause opens with at most "please" and closes with at most "please" and a full stop. */
const CLAUSE_START = '^\\s*(?:please\\s+)?';
const CLAUSE_END = '(?:\\s+please)?\\s*\\.?\\s*$';

/** Registry phrases bound this; each pattern is built once. */
const phrasePatterns = new Map<string, RegExp>();

function getPhrasePattern(phrase: string): RegExp {
    const cached = phrasePatterns.get(phrase);
    if (cached) {
        return cached;
    }
    const body = phrase
        .split(' ')
        .filter(Boolean)
        .map((word) => (word === REFERENCE_PLACEHOLDER ? MASKED_REFERENCE : escapeRegExp(word)))
        .join('\\s+');
    const pattern = new RegExp(`${CLAUSE_START}(${body})\\s+${DECIBEL_FIGURE}${CLAUSE_END}`, 'diu');
    phrasePatterns.set(phrase, pattern);
    return pattern;
}

/**
 * The place a phrase naming its project object with `{reference}` occurs in a clause that is exactly the
 * phrase and its decibel figure: "set □□□□□ to -6 dB" for "set {reference} to". The placeholder is one
 * masked reference, optionally after "the". Any other word in the clause, a missing, doubled or split
 * reference included, names nothing, so a clause that says more than the level never reads as a bare one.
 */
export function findReferencedIntentPhrase(text: string, phrase: string): ReferencedIntentPhraseMatch | null {
    const match = getPhrasePattern(phrase).exec(text);
    const phraseSpan = match?.indices?.[1];
    const slotSpan = match?.indices?.[2];
    if (!phraseSpan || !slotSpan) {
        return null;
    }
    const normalizedPrefix = normalizePromptText(text.slice(0, phraseSpan[0]));
    return {
        index: normalizedPrefix.length === 0 ? 0 : normalizedPrefix.length + 1,
        slot: { start: slotSpan[0], end: slotSpan[1] },
    };
}
