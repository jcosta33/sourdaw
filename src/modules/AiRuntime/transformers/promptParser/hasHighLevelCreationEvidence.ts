import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

const CREATION_VERB_PATTERN = /\b(?:create|add|build|make|start|compose|write|produce|set\s?up|lay\s+down)\b/giu;

/**
 * An object introduced rather than referred to. The determiner is what carries the meaning: "a bass
 * track" asks for one to exist, "the bass track" points at one that already does. Every noun stands
 * behind that determiner, whole works included, because a request reaches for a song it already has
 * as readily as for one it wants written: "add reverb to the song" edits, "write a song" creates.
 *
 * Bare `bass` is deliberately absent. It names a frequency range as often as an instrument, so "add
 * a little more bass" would read as creation; only `bass line` names the part.
 */
const INTRODUCED_OBJECT_PATTERN =
    /\b(?:a|an|new|some|another|\d+)\s+((?:\w+\s+){0,2})(?:tracks?|clips?|song|session|project|arrangement|composition|piece|demo|jingle|melody|beat|groove|loop|riff|comp|progression|chords?|drums|bass\s?lines?|drum\s+parts?)\b/giu;

/** A preposition right before the determiner makes the phrase an edit's destination. */
const PRECEDING_PREPOSITION_PATTERN = /\b(?:to|on|onto|into|over|across|of|for|under|behind|through|with)\s+$/iu;

/** The same words, or a definite article, between determiner and noun point back at what exists. */
const REFERRING_GAP_PATTERN = /\b(?:to|on|onto|into|over|across|of|for|under|behind|through|with|the)\b/iu;

/** Separators a request writes between one instruction and the next. */
const CLAUSE_SEPARATOR_PATTERN = /[,;.!?]|\bthen\b|\band\b/iu;

const NEGATION_PATTERN =
    /\b(?:not|never|no|without|cannot|avoid|stop|refrain|don'?t|doesn'?t|won'?t|can'?t|shouldn'?t|mustn'?t|isn'?t)\b/iu;

/**
 * A creation verb the clause does not take back before it reaches it. The last verb in the clause
 * decides, because a negation only reaches forward: "make sure you never create a track" opens on an
 * unqualified verb and is still a refusal, and reading the first verb's prefix would admit it.
 */
function hasUnnegatedCreationVerb(clause: string): boolean {
    const lastVerb = [...clause.matchAll(CREATION_VERB_PATTERN)].at(-1);
    return lastVerb?.index !== undefined && !NEGATION_PATTERN.test(clause.slice(0, lastVerb.index));
}

/**
 * An object the clause introduces rather than one it reaches for. A determiner alone does not
 * decide it, because an edit names its destination the same way: what disqualifies a match is a
 * preposition immediately before the determiner, as in "add reverb to a few tracks", or a
 * preposition or definite article between the determiner and the noun, as in "make some of the
 * tracks louder". Both say the objects already exist. Every match in the clause is tried, so one
 * disqualified phrase cannot hide a genuine introduction elsewhere in the same clause.
 */
function introducesSomethingNew(clause: string): boolean {
    return [...clause.matchAll(INTRODUCED_OBJECT_PATTERN)].some(
        (match) =>
            match.index !== undefined &&
            !PRECEDING_PREPOSITION_PATTERN.test(clause.slice(0, match.index)) &&
            !REFERRING_GAP_PATTERN.test(match[1] ?? '')
    );
}

function namesSomethingToCreate(clause: string): boolean {
    return MUSICAL_GENRE_PATTERN.test(clause) || introducesSomethingNew(clause);
}

/**
 * Whether the request asks for something to be created without naming what. The verb and the object
 * must share one clause, so "delete the drums and create nothing" carries no creation evidence.
 *
 * The argument is the user request alone. Project data must never reach this text: a stored track
 * named like a creative request would otherwise buy a grounding waiver the user never asked for.
 */
export function hasHighLevelCreationEvidence(request: string): boolean {
    return request
        .split(CLAUSE_SEPARATOR_PATTERN)
        .some((clause) => hasUnnegatedCreationVerb(clause) && namesSomethingToCreate(clause));
}
