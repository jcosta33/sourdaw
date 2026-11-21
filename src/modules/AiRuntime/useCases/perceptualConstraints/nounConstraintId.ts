import { FAMILY_IDS, FAMILY_OF_NOUN, type MeasuredConstraintId, NOUN_MOVEMENT_OF_VERB } from './constraintDirections';

function normalizeWords(words: string): string {
    return words.toLowerCase().replaceAll(/\s+/gu, ' ').trim();
}

/**
 * A held noun's constraint, read from the direction table: its family's bound when the verb moves it
 * one way, its hold otherwise ("change", "touch", a keep or no verb). A noun the table does not hold
 * states nothing.
 */
export function nounConstraintId(noun: string, verb: string | undefined): MeasuredConstraintId | undefined {
    const family = FAMILY_OF_NOUN.get(normalizeWords(noun));
    if (family === undefined) {
        return undefined;
    }
    const ids = FAMILY_IDS[family];
    const movement = verb === undefined ? undefined : NOUN_MOVEMENT_OF_VERB.get(normalizeWords(verb));
    if (movement === 'up') {
        return ids.raised;
    }
    if (movement === 'down') {
        return ids.lowered;
    }
    return ids.held;
}
