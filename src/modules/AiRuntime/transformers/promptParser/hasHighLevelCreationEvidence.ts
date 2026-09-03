import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

const CREATION_VERB_PATTERN = /\b(?:create|add|build|make|start|compose|write|produce|set\s?up|lay\s+down)\b/giu;

/**
 * Words that name a whole work rather than anything inside one. A project holds tracks, clips and
 * parts; it is not itself something a request can point at as an edit target, so asking for one of
 * these is always asking for it to exist. Anything a project can already contain belongs in
 * `INTRODUCED_OBJECT_PATTERN` instead, where a determiner has to do the work.
 */
const SONG_LEVEL_NOUN_PATTERN = /\b(?:song|session|project|arrangement|composition|piece|demo|jingle)\b/iu;

/**
 * An object introduced rather than referred to. The determiner is what carries the meaning: "a bass
 * track" asks for one to exist, "the bass track" points at one that already does. Every noun a
 * project can already hold lives here, because "add a delay to the loop" edits the loop it names
 * and only "add another loop" asks for one.
 */
const INTRODUCED_OBJECT_PATTERN =
    /\b(?:a|an|new|some|another|\d+)\s+(?:\w+\s+){0,2}(?:tracks?|clips?|melody|beat|groove|loop|riff|comp|progression|bass\s?lines?|drum\s+parts?)\b/iu;

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

function namesSomethingToCreate(clause: string): boolean {
    return (
        MUSICAL_GENRE_PATTERN.test(clause) ||
        SONG_LEVEL_NOUN_PATTERN.test(clause) ||
        INTRODUCED_OBJECT_PATTERN.test(clause)
    );
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
