import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

const CREATION_VERB_PATTERN = /\b(?:create|build|make|start|compose|write|produce|set\s?up|lay\s+down)\b/iu;

/**
 * Words that cannot name something the project already holds, so asking for one is asking for it to
 * exist. A bare `track` or `melody` is deliberately absent: those name edit targets just as often as
 * creations, and "make the drums louder" must not read as a request to create drums.
 */
const SONG_LEVEL_NOUN_PATTERN =
    /\b(?:song|session|project|arrangement|progression|beat|groove|loop|riff|bassline|comp)\b/iu;

/**
 * An object introduced rather than referred to. The determiner is what carries the meaning: "a bass
 * track" asks for one to exist, "the bass track" points at one that already does.
 */
const INTRODUCED_OBJECT_PATTERN =
    /\b(?:a|an|new|some|another|\d+)\s+(?:\w+\s+){0,2}(?:tracks?|clips?|melody|bass|drums|chords)\b/iu;

/** Separators a request writes between one instruction and the next. */
const CLAUSE_SEPARATOR_PATTERN = /[,;.!?]|\bthen\b|\band\b/iu;

const NEGATION_PATTERN = /\b(?:not|never|no|without|cannot|don'?t|doesn'?t|won'?t)\b/iu;

/** A creation verb the clause does not take back before it reaches it. */
function hasUnnegatedCreationVerb(clause: string): boolean {
    const verb = CREATION_VERB_PATTERN.exec(clause);
    return verb !== null && !NEGATION_PATTERN.test(clause.slice(0, verb.index));
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
