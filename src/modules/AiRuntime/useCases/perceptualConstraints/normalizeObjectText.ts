import { BRACKET } from './constraintClauseWords';
import { normalizeObjectName } from './normalizeObjectName';

const BRACKETS = new RegExp(BRACKET, 'gu');

/**
 * An object's words as a role, mix word or pronoun is read from: its name with its brackets dropped too,
 * so an aside read inside its clause reads as its unbracketed form does ("don't make (the) vocal louder").
 */
export function normalizeObjectText(text: string): string {
    return normalizeObjectName(text.replaceAll(BRACKETS, ''));
}
