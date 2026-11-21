import { BRACKET, MASK_GLYPH } from './constraintClauseWords';

const BRACKETS = new RegExp(BRACKET, 'gu');

/** A text read across its brackets, and the offset of each bracket it was read across. */
export type AcrossBrackets = { text: string; brackets: number[] };

/**
 * The text with every bracket it still holds read as a masked character of the word it stands in, offsets
 * kept, so a clause is read across it as though the bracket ended nothing.
 */
export function readAcrossBrackets(text: string): AcrossBrackets {
    return {
        text: text.replaceAll(BRACKETS, MASK_GLYPH),
        brackets: Array.from(text.matchAll(BRACKETS), (bracket) => bracket.index),
    };
}
