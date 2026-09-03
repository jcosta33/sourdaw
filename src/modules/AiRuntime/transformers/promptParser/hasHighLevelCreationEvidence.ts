import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

const CREATION_VERB_PATTERN = /\b(?:create|add|begin|build|make|start|compose|write|produce|set\s?up|lay\s+down)\b/giu;

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
    /\b(?:a|an|new|some|another|\d+)\s+((?:\w+\s+){0,2}?)(?:tracks?|clips?|song|session|project|arrangement|composition|piece|demo|jingle|melod(?:y|ies)|beats?|grooves?|loops?|riffs?|comps?|progressions?|chords?|drums|bass\s?lines?|drum\s+parts?)\b/giu;

/**
 * A preposition right before the determiner makes the phrase an edit's destination. `with` is
 * absent on purpose: "start with a drum track" begins a piece rather than pointing into one.
 */
const PRECEDING_PREPOSITION_PATTERN = /\b(?:to|on|onto|into|over|across|of|for|under|behind|through)\s+$/iu;

/**
 * A word between the determiner and the noun that points at objects the project already holds, as
 * in "make some of the tracks louder". Only referring words qualify, never a preposition: a
 * quantifier reaches its noun through one, and "create a couple of tracks" asks for new tracks.
 */
const REFERRING_GAP_PATTERN = /\b(?:the|my|our|your|its|their|this|that|these|those)\b/iu;

/**
 * The gap between the determiner and the noun ending in a bare "of", as in "a copy of", "a
 * duplicate of", "a bounce of", "a stem of". The qualifier alone does not decide it: "a couple of
 * tracks" and "a bunch of drums" end the same way and still introduce something new. This pattern
 * only disqualifies a match when paired with `namesAnExistingIdentifier` below, which reads the
 * text right after the noun for the identifier tail that turns "of" into a reference to one
 * specific object the project already holds. Accepted edge: "create a couple of tracks 8 bars
 * long" reads its numbered tail the same way and is refused, even though the tail describes new
 * tracks rather than picking one out; the plain "create a couple of tracks", with no identifier
 * tail, still counts as creation.
 */
const PARTITIVE_GAP_PATTERN = /\bof\s*$/iu;

/**
 * A decimal or hash-prefixed identifier number immediately after the matched noun, as in "track 3"
 * or "track #3", read case-insensitively.
 */
const OBJECT_IDENTIFIER_NUMBER_PATTERN = /^\s+#?\d+\b/u;

/**
 * A single capital letter identifier immediately after the matched noun, as in "clip A". Read
 * case-sensitively on purpose: a lowercase letter is ordinary prose, not an identifier, and
 * admitting it would false-disqualify real creation requests that happen to end on a short word.
 *
 * A spelled-out number ("track three") is deliberately not read as an identifier: unlike a decimal,
 * hash-prefixed, or lettered tail, a spelled-out number reads as a pronoun as often as an
 * identifier, as in "a bunch of drums one after another" or "a set of chords three at a time" — both
 * still introduce something new, and disqualifying them would cost that reading.
 */
const OBJECT_IDENTIFIER_LETTER_PATTERN = /^\s+[A-Z]\b/u;

/**
 * An identifier immediately after the matched noun, as in "track 3", "track #3", or "clip A".
 * Paired with PARTITIVE_GAP_PATTERN, it turns a partitive phrase into a reference to an existing
 * object: the object named by kind and identifier is what is duplicated or bounced, not created.
 */
function namesAnExistingIdentifier(tail: string): boolean {
    return OBJECT_IDENTIFIER_NUMBER_PATTERN.test(tail) || OBJECT_IDENTIFIER_LETTER_PATTERN.test(tail);
}

/**
 * A number-of-beats phrase, as in "8 beats", "1 beat", or "8 more beats", where the matched
 * determiner is itself the count and the whole match names a duration rather than an object: "make
 * the intro 8 beats longer" measures an edit, it does not ask for eight beats to exist. Tested
 * against the whole match text, and shares INTRODUCED_OBJECT_PATTERN's own two-word gap allowance
 * so a qualifier between the count and "beats" (as in "more" or "extra") does not evade it.
 */
const MEASURE_PHRASE_PATTERN = /^\d+\s+(?:\w+\s+){0,2}beats?$/iu;

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
 * preposition immediately before the determiner, as in "add reverb to a few tracks"; a referring
 * word between the determiner and the noun, as in "make some of the tracks louder"; a partitive gap
 * paired with an identifier tail, as in "make a copy of track 3"; or a numeric determiner naming a
 * beat count, as in "make the intro 8 beats longer". All four say the objects already exist, or
 * that no object is named at all.
 *
 * The gap is lazy so the shortest reading of each phrase is tried first: "a track of drums"
 * introduces a track, and a greedy gap would instead read it as reaching for drums and discard the
 * phrase. One match per starting determiner is examined, so a disqualified phrase cannot hide a
 * genuine introduction that starts elsewhere in the clause.
 *
 * A determiner on the verb's own object is deliberately not disambiguated: "make some tracks
 * louder" reads as creation and stays that way. Tightening it would cost the plain creation
 * requests this gate exists for, and the evidence opens a route that admits only commands confined
 * to objects the same batch creates — so a false positive here buys no authority over anything that
 * already exists, exactly as with the genre term.
 */
function introducesSomethingNew(clause: string): boolean {
    return [...clause.matchAll(INTRODUCED_OBJECT_PATTERN)].some(
        (match) =>
            match.index !== undefined &&
            !PRECEDING_PREPOSITION_PATTERN.test(clause.slice(0, match.index)) &&
            !REFERRING_GAP_PATTERN.test(match[1] ?? '') &&
            !(
                PARTITIVE_GAP_PATTERN.test(match[1] ?? '') &&
                namesAnExistingIdentifier(clause.slice(match.index + match[0].length))
            ) &&
            !MEASURE_PHRASE_PATTERN.test(match[0])
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
