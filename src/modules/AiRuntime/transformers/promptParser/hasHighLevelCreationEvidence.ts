import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

const CREATION_VERB_PATTERN = /\b(?:create|build|make|start|compose|write|produce|set\s?up|lay\s+down)\b/iu;

const MUSICAL_OBJECT_NOUN_PATTERN =
    /\b(?:song|tracks?|beat|session|project|arrangement|progression|loop|groove|riff|bassline|drums|melody|chords|comp)\b/iu;

/** Separators a request writes between one instruction and the next. */
const CLAUSE_SEPARATOR_PATTERN = /[,;.!?]|\bthen\b|\band\b/iu;

/**
 * Whether the request asks for something to be created without naming what. The verb and the object
 * must share one clause, so "mute the drums and create nothing" does not read as a creation request.
 *
 * The argument is the user request alone. Project data must never reach this text: a stored track
 * named like a creative request would otherwise buy a grounding waiver the user never asked for.
 */
export function hasHighLevelCreationEvidence(request: string): boolean {
    return request
        .split(CLAUSE_SEPARATOR_PATTERN)
        .some(
            (clause) =>
                CREATION_VERB_PATTERN.test(clause) &&
                (MUSICAL_OBJECT_NOUN_PATTERN.test(clause) || MUSICAL_GENRE_PATTERN.test(clause))
        );
}
