import { BRACKET, INNER_ASIDE, OBJECT_ASIDE_OPENING } from './constraintClauseWords';

const BRACKETS = new RegExp(BRACKET, 'gu');
const INNER_ASIDES = new RegExp(INNER_ASIDE, 'gu');
const OBJECT_ASIDE_OPENINGS = new RegExp(OBJECT_ASIDE_OPENING, 'gu');

/**
 * The text with the brackets of each aside read inside its clause turned to spaces, offsets kept, so that
 * clause reads as its unbracketed form does, on the object it names: an aside the clause goes on after
 * ("keep the level (of the vocal) the same" holds the vocal's level, "keep the vocal (lead) bright" names
 * "the vocal lead") and one naming the object before it ("keep the brightness (of the vocal)"). Any
 * other bracket is left to end its clause.
 */
export function readInnerAsides(text: string): string {
    return text
        .replaceAll(INNER_ASIDES, (aside) => aside.replaceAll(BRACKETS, ' '))
        .replaceAll(OBJECT_ASIDE_OPENINGS, ' ');
}
