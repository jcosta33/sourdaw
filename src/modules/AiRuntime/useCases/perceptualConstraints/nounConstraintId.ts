import { FAMILY_IDS, type MeasuredConstraintId, type QualityFamily } from './constraintDirections';

/** A verb that raises a held noun's metric, or lowers it; any other verb ("change", "touch") holds it. */
const RAISING_NOUN_VERB = /^(?:rais|increas|boost|push|turn(?:ing)?\s+up|widen|brighten)/iu;
const LOWERING_NOUN_VERB = /^(?:lower|reduc|decreas|turn(?:ing)?\s+down|narrow|darken|squash|flatten)/iu;

function familyOfNounWord(word: string): QualityFamily {
    if (/^(?:width|image|field|spread)$/u.test(word)) {
        return 'width';
    }
    if (word === 'brightness') {
        return 'brightness';
    }
    if (word.startsWith('dynamic')) {
        return 'dynamics';
    }
    return 'loudness';
}

/** A held noun's constraint: its family's bound when the verb moves it one way, its hold otherwise. */
export function nounConstraintId(noun: string, verb: string | undefined): MeasuredConstraintId {
    const ids = FAMILY_IDS[familyOfNounWord(noun.toLowerCase())];
    if (verb !== undefined && RAISING_NOUN_VERB.test(verb)) {
        return ids.raised;
    }
    if (verb !== undefined && LOWERING_NOUN_VERB.test(verb)) {
        return ids.lowered;
    }
    return ids.held;
}
