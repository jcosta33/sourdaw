import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { PROJECT_REFERENCE_MASK_GLYPH } from '../agentReference/groundingStrategies/maskProjectReferences';

import {
    APOSTROPHE,
    COMPARATIVE_WORDS,
    DIRECTION,
    NOUN_VERB_ING,
    WHOLE_WORD_END,
    WORD_END,
} from './constraintDirections';
import { HYPHEN_OR_SPACE, words } from './words';

/**
 * The clause words every constraint reader shares, each vocabulary stated here once: scope words,
 * determiners, clause boundaries, negations, the verbs a clause turns on, and the object grammar.
 */

export const MIX_WORDS = new Set(['mix', 'whole mix', 'song', 'whole song', 'project', 'master', 'master bus']);
export const ROLE_WORDS: ReadonlyMap<string, SemanticCommandListRoleFamily> = new Map([
    ['vocal', 'vocal'],
    ['vocals', 'vocal'],
    ['lead vocal', 'vocal'],
    ['lead vocals', 'vocal'],
    ['vox', 'vocal'],
    ['drum', 'drums'],
    ['drums', 'drums'],
    ['bass', 'bass'],
    ['guitar', 'guitar'],
    ['guitars', 'guitar'],
    ['keys', 'keys'],
]);
const IT = 'it';
const MIX_PRONOUN_WORDS = [IT, 'everything', 'anything'];
/** The pronouns that hold the mix while the request names no track or role before them. */
export const MIX_PRONOUNS: ReadonlySet<string> = new Set(MIX_PRONOUN_WORDS);
export const MIX_PRONOUN = words(MIX_PRONOUN_WORDS);
/** The role words alone: what makes a later "it" name no single scope. */
export const ROLE_WORD = words(Array.from(ROLE_WORDS.keys()));
/** The role and mix words an object member may open with, longest first, so "lead vocal" is one member. */
export const SCOPE_WORD = words([...ROLE_WORDS.keys(), ...MIX_WORDS]);

/** The brackets opening an aside, which a joining word after one may continue a list across. */
const OPENING_BRACKET_MARKS = String.raw`(\[`;
const OPENING_BRACKET = `[${OPENING_BRACKET_MARKS}]`;
const CLOSING_BRACKET_MARKS = String.raw`)\]`;
const BRACKET_MARKS = `${OPENING_BRACKET_MARKS}${CLOSING_BRACKET_MARKS}`;
/**
 * The marks that end a clause, one character class each way: a mark, and any character but one. A bracket,
 * opening or closing, ends the clause before it, so no word holds one: "keep the vocal bright (and make
 * the drums louder)" holds the vocal's brightness as its unbracketed form does. An aside the clause goes
 * on after is read inside it instead (`readInnerAsides`).
 */
const CLAUSE_MARKS = `,.;:!?${BRACKET_MARKS}`;
export const CLAUSE_PUNCTUATION = `[${CLAUSE_MARKS}]`;
const NOT_CLAUSE_PUNCTUATION = `[^${CLAUSE_MARKS}]`;
/** A character of a word: neither whitespace nor a clause mark. */
export const WORD_CHARACTER = String.raw`[^\s${CLAUSE_MARKS}]`;
/**
 * The ampersand, which is "and" written as a mark: spaced, it ends a clause where "and" does (it is a
 * separator token) and joins a later member wherever "and" joins one ("don't make the mix wider & the
 * vocal brighter"), and unspaced it joins object members ("vocal&drums").
 */
const AMPERSAND = '&';
/** A spaced ampersand: "and" written as a mark. */
export const SPACED_AMPERSAND = String.raw`(?<!\S)${AMPERSAND}(?!\S)`;
/** The marks separating clauses only as a token of their own, since each may join words: "lo-fi", "3–4 dB". */
const TOKEN_SEPARATOR_MARKS = String.raw`\-–${AMPERSAND}/`;
/** An em dash, which joins no word, so it separates clauses spaced or not: "the punch—make the vocal brighter". */
const EM_DASH = '—';
/**
 * What separates two clauses without a clause mark: a dash, ampersand (as "and" ends one) or slash
 * standing as a token of its own ("keep the vocal bright - make the drums wider"), an em dash wherever it
 * stands, or a line break.
 * It is never a word of either.
 */
export const CLAUSE_SEPARATOR = String.raw`(?:(?<!\S)[${TOKEN_SEPARATOR_MARKS}${EM_DASH}]+(?!\S)|${EM_DASH}|[\n\r])`;
/** A character of the same clause: no clause mark and no separator. */
export const SAME_CLAUSE_CHARACTER = String.raw`(?:(?!${CLAUSE_SEPARATOR})${NOT_CLAUSE_PUNCTUATION})`;
/** Whitespace within one line. */
const SAME_CLAUSE_SPACE = String.raw`(?:(?!${CLAUSE_SEPARATOR})\s)+`;

/** The glyph a masked track name or quotation is read as, one per character. */
export const MASK_GLYPH = PROJECT_REFERENCE_MASK_GLYPH;

const THE_WORD = 'the';
const THAT = 'that';
export const DETERMINER = words([THE_WORD, 'my', 'our', 'this', THAT]);
/** The definite article alone, which a held noun list and a held state open with: "the level", "the same". */
export const THE = words([THE_WORD]);
/** The possessives a continued clause may open with: "and its width". */
export const POSSESSIVE_DETERMINER = words(['its', 'their']);
/** The determiner an object's name is read without: "the vocal" names the vocal. */
export const LEADING_DETERMINER = new RegExp(String.raw`^${DETERMINER}\s+`, 'u');
/** A quotation mark or an apostrophe, which an object's name is read without. */
export const QUOTE_MARK = new RegExp(`["“”‘]|${APOSTROPHE}`, 'gu');

const ANY_WORD = 'any';
const SO = 'so';
/** The degree words a comparative or a measured word may carry: "any louder", "too bright", "much louder". */
export const DEGREE_WORD = words([ANY_WORD, 'more', 'less', 'too', 'much', SO]);
/** "any" alone, which a comparative may carry ("any wider") and an object never opens with. */
export const ANY = words([ANY_WORD]);

const AND = 'and';
const OR = 'or';
const BUT = 'but';
const WHILE = 'while';
const HARD_BOUNDARY_WORDS = [BUT, WHILE, SO, 'then', 'please'];
/**
 * The one way a later member joins the one before it, for every list a clause reads: a comma, with or
 * without one of the joining words after it, a clause separator or an opening bracket with one of them
 * after it, or one of those words alone: "the level, and the width", "louder—or brighter", "louder (or
 * brighter)". A separator or bracket with no joining word after it still ends the clause ("the
 * punch—make the vocal brighter").
 */
function joinedBy(joiningWords: string): string {
    return String.raw`(?:\s*,\s*(?:${joiningWords}\s+)?|\s*(?:${CLAUSE_SEPARATOR}|${OPENING_BRACKET})\s*${joiningWords}\s+|\s+${joiningWords}\s+)`;
}
/** Joining words holding "and", which a spaced ampersand also writes: "the level & the width". */
function withAmpersand(joiningWords: string): string {
    return String.raw`(?:${joiningWords}|${AMPERSAND})`;
}
/** A comma or "and" joining a later noun or object to the one before it: "the level, and the width". */
export const AND_JOIN = joinedBy(withAmpersand(words([AND])));
/** The words joining list members: "the vocal and the drums", "louder or brighter". */
export const LIST_JOINER = words([AND, OR]);
/**
 * A comma, "and" or "or" joining a later direction or object to the one before it: "brighter, wider, or
 * louder", "don't make the mix wider, or the vocal brighter".
 */
export const LIST_JOIN = joinedBy(withAmpersand(LIST_JOINER));
/** A comma, "and" or "but" joining a later kept term to the one before it: "keep the vocal bright but dynamic". */
export const TERM_JOIN = joinedBy(withAmpersand(words([AND, BUT])));
/** The words that end a clause whatever follows them; "and" and "or" may instead continue a list. */
export const HARD_BOUNDARY_WORD = words(HARD_BOUNDARY_WORDS);
/** The words a readable clause ends at: "or" is not one, since it lists inside a clause. */
const CLAUSE_BOUNDARY_WORD = words([AND, ...HARD_BOUNDARY_WORDS]);
/**
 * Every word that ends a clause or joins the members of a list inside one ("or"), which neither a word
 * of an object member nor a character of a clause short of its boundary holds.
 */
const ANY_BOUNDARY_WORD = words([AND, OR, ...HARD_BOUNDARY_WORDS]);
export const CLAUSE_END = String.raw`(?=\s*(?:$|${CLAUSE_PUNCTUATION}|${CLAUSE_SEPARATOR}|\b${CLAUSE_BOUNDARY_WORD}\b))`;
/** Any bracket, opening or closing. */
export const BRACKET = `[${BRACKET_MARKS}]`;
/**
 * A closed aside the clause goes on after: "keep the level (of the vocal) the same", never "… bright
 * (please)". One holding a word that ends a clause whatever follows is none, since read inside its
 * clause that word would end it: "don't make the (please) vocal louder".
 */
export const INNER_ASIDE = String.raw`${OPENING_BRACKET}(?:(?!\b${HARD_BOUNDARY_WORD}\b)[^${BRACKET_MARKS}])*[${CLOSING_BRACKET_MARKS}](?!${CLAUSE_END})`;

/** The object may stand before the verb only at the head of a clause, so it never swallows an earlier clause. */
export const CLAUSE_HEAD = String.raw`(?<=^|${CLAUSE_PUNCTUATION}\s*|${CLAUSE_SEPARATOR}\s*|\b${CLAUSE_BOUNDARY_WORD}\s+)`;
/** The prepositions an object follows a held noun or the low end by: "the level of the drums". */
const ON_WORD = 'on';
export const OBJECT_PREPOSITION = words(['of', ON_WORD, 'in']);
/**
 * The bracket opening an aside that goes on naming the object before it, closed or not: "keep the
 * brightness (of the vocal)", "don't touch the low end (of the bass".
 */
export const OBJECT_ASIDE_OPENING = String.raw`${OPENING_BRACKET}(?=\s*${OBJECT_PREPOSITION}\b)`;
/** "on" alone, which a keep continuing a move may carry: "keep on widening". */
const ON = words([ON_WORD]);
/** "at", which a level is kept at: "keep the Keys at the same level". */
export const AT = words(['at']);
/** The low end, by either name, its words spaced or hyphenated: "the low end", "the bottom-end". */
export const LOW_END = words(['low end', 'bottom end'], HYPHEN_OR_SPACE);

export const KEEP = words(['keep', 'keeping']);
const PRESERVING_VERB = words(['preserve', 'preserving', 'maintain', 'maintaining', 'retain', 'retaining']);
export const KEEP_VERBS = String.raw`(?:${KEEP}|${PRESERVING_VERB})`;
export const LEAVE_VERB = words(['leave', 'leaving']);
const STOPPING_WORD = words(['stop', 'stopping', 'prevent', 'preventing']);
/**
 * The intents a release may give a keep, stop or prevent up through: "stop caring about keeping …", "stop
 * trying to keep …", "quit worrying about keeping …".
 */
const RELEASED_INTENT = words(['caring about', 'trying to', 'trying', 'bothering to', 'bothering', 'worrying about']);
/** The verbs a "stop" gives up rather than prevents through: "stop keeping …", "stop worrying about …". */
const RELEASED_VERB = String.raw`(?:${KEEP_VERBS}|${STOPPING_WORD}|${LEAVE_VERB}|${RELEASED_INTENT})`;
/**
 * A stop or prevent, never one releasing another keep or stop ("stop keeping the mix from getting
 * wider", "stop preventing …"), which the release reads instead.
 */
export const STOP_VERB = String.raw`${STOPPING_WORD}(?!\s+${RELEASED_VERB}${WORD_END})`;
/** "avoid making it louder" governs what follows as a negation does. */
export const AVOID_VERB = words(['avoid', 'avoiding']);
/** The verbs a subject becomes a level through on its own: "the mix must not get louder", "don't go louder". */
export const BECOMING_VERB = words(['get', 'getting', 'become', 'becoming', 'go', 'going']);
/** The verbs that make a quality become a level ("don't make it louder"), beside those a held noun takes. */
const MAKING_VERB = words(['make', 'making', 'let', 'letting']);
export const CAUSING_VERB = String.raw`(?:${MAKING_VERB}|${BECOMING_VERB})`;
/** The verb a level is wanted through, which a negation bounds as it bounds a causing verb: "I don't want it louder". */
export const WANTING_VERB = words(['want', 'wanting']);
/** The verbs linking a subject to how it sounds: "shouldn't be louder", "sounding bright". */
export const LINKING_VERB = words(['be', 'being', 'sound', 'sounding', 'feel', 'feeling', 'seem', 'seeming']);
/**
 * The linking verbs that describe how a subject sounds as it is: after a subject's "never" they state
 * no bound ("the vocal never sounds louder"), as "doesn't sound brighter" states none.
 */
const DESCRIBING_VERB = words(['sound', 'sounds', 'feel', 'feels', 'seem', 'seems']);
/** The verbs a quality changes into a level through beside "get" and "become": "from going brighter". */
const CHANGING_VERB = words([
    'goes',
    'turn',
    'turns',
    'turning',
    'grow',
    'grows',
    'growing',
    'end up',
    'ends up',
    'ending up',
    'gets',
    'becomes',
]);
/** The verbs a quality shows as a level through beside the linking verbs: "from looking brighter". */
const APPEARING_VERB = words([
    'look',
    'looks',
    'looking',
    'appear',
    'appears',
    'appearing',
    'come across',
    'comes across',
    'coming across',
    'sounds',
    'feels',
    'seems',
]);
/**
 * Every verb a move is named through before its direction: "sound louder", "getting wider", "from
 * going brighter", "turning narrower", "coming across darker". The verb is never part of the object.
 */
export const MOVE_LEAD_VERB = String.raw`(?:${LINKING_VERB}|${BECOMING_VERB}|${CHANGING_VERB}|${APPEARING_VERB})`;

const AS_WORD = 'as';
/** "as", which a kept term ("as dynamic") and a kept state ("as it is") stand behind. */
export const AS = words([AS_WORD]);
const IS = 'is';
/** The states a kept object stays in: "intact", "as it is", "as is". */
const UNCHANGED_STATE = words(['unchanged', 'intact', `${AS_WORD} ${IT} ${IS}`, `${AS_WORD} ${IS}`]);
/** The states only a left object stays in, beside those: "leave the low end alone". */
const LEFT_ONLY_STATE = words(['alone', 'untouched']);
/** Every state a left or kept object stays in: "leave the low end alone", "keep the low end intact". */
export const LEFT_STATE = String.raw`(?:${LEFT_ONLY_STATE}|${UNCHANGED_STATE})`;
/** "the same", which a held noun stays and a level is kept at: "keep the Keys at the same level". */
export const THE_SAME = String.raw`${THE}\s+same`;
/** The states a kept measured noun stays in: "keep the level the same", "where it is". */
export const HELD_STATE = String.raw`(?:${THE_SAME}|${words([`where ${IT} ${IS}`])}|${UNCHANGED_STATE})`;

/**
 * What joins a contraction's two halves, each listed contraction written to the builder as two words
 * ("don t"): an apostrophe, typed, typeset or left out, so "don't", "don’t" and "dont" are one word. The
 * one contraction no list names is `NEGATED_CONTRACTION`, any word ending in "n't".
 */
const CONTRACTION = `${APOSTROPHE}?`;
const WITHOUT = 'without';
const NOT = 'not';
const NEVER = 'never';
export const NEGATION = String.raw`(?:${words([`do ${NOT}`, NEVER, WITHOUT])}|${words(['don t'], CONTRACTION)})`;
const CAN = 'can';
const MODAL_WORDS = ['must', 'should', 'may', CAN, 'will'];
const MODAL = words(MODAL_WORDS);
/**
 * A negation no modal stands before, which opens a clause of its own ("never get wider"). The "never" of
 * "the drums should never get wider" is the modal's, and the modal clause reads its subject.
 */
export const OPENING_NEGATION = String.raw`(?<!\b${MODAL}\s+)${NEGATION}`;
/** A modal with "never" after it, which states a bound as "must not" does: "the drums should never get wider". */
const MODAL_NEVER = words(MODAL_WORDS.map((modal) => `${modal} ${NEVER}`));
/**
 * A subject's own "never", which states a bound on that subject ("the drums never get wider"), unless a
 * describing verb follows it: "the vocal never sounds louder" describes the vocal as it is.
 */
const SUBJECT_NEVER = String.raw`${words([NEVER])}(?!\s+${DESCRIBING_VERB}${WORD_END})`;
/** Each modal's contracted negation, and those dropping a letter of their modal: "mustn't", "can't", "won't". */
const MODAL_CONTRACTION = words([...MODAL_WORDS.map((modal) => `${modal}n t`), `${CAN} t`, 'won t'], CONTRACTION);
/** "doesn't get louder" asks for a bound; "doesn't sound brighter" describes the sound as it is. */
export const DOES_NOT = String.raw`(?:${words([`does ${NOT}`])}|${words(['doesn t'], CONTRACTION)})`;
const DOES_NEGATION = String.raw`${DOES_NOT}(?!\s+${LINKING_VERB}\b)`;
/**
 * The head of a purpose clause, after "so" or "so that": there "doesn't sound louder" asks for a bound
 * ("add some warmth so it doesn't sound louder") rather than describing the sound as it is.
 */
export const PURPOSE_HEAD = String.raw`(?<=\b${SO}\s+(?:${THAT}\s+)?)(?!${THAT}\s)`;
/**
 * Each modal followed by "not", and "cannot", the one modal written as one word with it: "must not", "cannot".
 */
const MODAL_NOT = words([...MODAL_WORDS.map((modal) => `${modal} ${NOT}`), `${CAN}${NOT}`]);
/** A modal verb's own negation: "shouldn't be", "mustn't get", "can't be", "won't get", "cannot be", "should never get". */
export const MODAL_VERB_NEGATION = String.raw`(?:${MODAL_NOT}|${MODAL_CONTRACTION}|${MODAL_NEVER})`;
/**
 * A modal negation states a clause, and so do "doesn't get" and a subject's "never"; a plain copula
 * negation ("isn't", "aren't", "wasn't") describes the sound as it is, so it is none.
 */
export const MODAL_NEGATION = String.raw`(?:${MODAL_VERB_NEGATION}|${DOES_NEGATION}|${SUBJECT_NEVER})`;
const NO_WORD = 'no';
const BARE_NEGATION = words([NO_WORD, NOT]);
/** "no" alone, before what it negates: "no louder", "no changes to the low end". */
export const NO = words([NO_WORD]);
/**
 * Any negated contraction ("isn't", "wouldn't"): an open-ended form the builder, which lists closed
 * words, cannot state, so it is written here once. Its apostrophe is required, since left out it would
 * read every word ending in "nt" ("want", "event") as a negation.
 */
const NEGATED_CONTRACTION = String.raw`\p{L}+n${APOSTROPHE}t`;
/** Any negation at all, which a keep or stop right after it permits: "don't keep …", "no need to keep …". */
const ANY_NEGATION = String.raw`(?:${NEGATION}|${MODAL_NEGATION}|${BARE_NEGATION}|${NEGATED_CONTRACTION})`;
/** A character of the same clause short of its boundary words. */
export const IN_CLAUSE_CHARACTER = String.raw`(?:(?!\b${ANY_BOUNDARY_WORD}\b)${SAME_CLAUSE_CHARACTER})`;

const HAVE_WORDS = ['has', 'have'];
const NEED_WORDS = ['needs', 'need'];
const WANT_WORDS = ['wants', 'want'];
const AUXILIARY_WORDS = [IS, 'are', 'was', 'were', 'been', ...HAVE_WORDS, 'had', 'do', 'does', 'did'];
const PREDICATE_VERB_WORDS = [...NEED_WORDS, ...WANT_WORDS, 'gets', 'got'];
const FROM_WORD = 'from';
const TO_WORD = 'to';
const COMPLEMENT_WORDS = [TO_WORD, FROM_WORD];
/** "to" alone, which "no changes" names what it protects after: "no changes to the low end". */
export const TO = words([TO_WORD]);
/** "from" alone, which a keep, stop or prevent names its move after: "keep the mix from getting louder". */
export const FROM = words([FROM_WORD]);
/** The verbs a negation permits a later verb through: "don't have to", "don't want to", "don't bother keeping". */
const PERMISSION_VERB = words([
    ...HAVE_WORDS,
    ...NEED_WORDS,
    ...WANT_WORDS,
    'bother',
    'try',
    'worry about',
    'care about',
]);
/** The adverbs a negation may carry before what it governs: "don't really need to", "don't even have to". */
const PERMISSION_ADVERB = words(['really', 'even', 'ever', 'actually']);
/** "feel", which leads a permission verb as a negation's own verb: "don't feel you need to …". */
const FEEL = words(['feel']);
/** The one person a permission may name: "I don't need you to keep …". */
const PERMITTED_PERSON = words(['you']);
/** The negations naming nobody, which a permission verb follows: "nobody needs to keep …". */
const NOBODY = words(['nobody', 'no one']);
/**
 * "no longer", which ends what was asked for as a negation does, before a permission verb or not: "no
 * longer keep …", "you no longer need to keep …".
 */
const NO_LONGER = words(['no longer']);
/** A permission a negation leads to the permitted verb through: "feel you need to", "bother to", "have to". */
const PERMISSION_LEAD = String.raw`(?:${FEEL}\s+(?:${PERMITTED_PERSON}\s+)?)?${PERMISSION_VERB}(?:\s+${PERMITTED_PERSON})?(?:\s+${TO})?`;
/**
 * The words releasing a keep, stop or prevent the request gives up rather than asks for: "stop keeping
 * …", "forget about keeping …", "no more keeping …", "I'm done keeping …", "instead of keeping …",
 * "remove the constraint keeping …", "stop preventing …".
 */
const RELEASE_LEAD = words([
    'stop',
    'quit',
    'cease',
    'skip',
    'forget',
    'forget about',
    'disregard',
    'cancel',
    'undo',
    'give up',
    'give up on',
    'no more',
    'done',
    'done with',
    'finished',
    'no point',
    'no point in',
    'no need for',
    'instead of',
    'rather than',
    'remove the constraint',
    'remove the rule',
    'drop the constraint',
    'lift the constraint',
]);
/** A negation or permission governing the verb right after it: "don't", "you don't have to", "nobody needs to". */
const GOVERNING_NEGATION = String.raw`\b(?:${ANY_NEGATION}|${NOBODY}|${NO_LONGER})(?:\s+${PERMISSION_ADVERB})*(?:\s+${PERMISSION_LEAD})?\s+`;
/** A verb's gerund, the "-ing" form a release or a continued move goes through: "keeping", "making". */
const GERUND = String.raw`\p{L}+ing${WORD_END}`;
/** A release lead no negation or permission governs: "stop", never the "stop" of "don't stop". */
const UNREFUSED_RELEASE = String.raw`(?<!${GOVERNING_NEGATION})\b${RELEASE_LEAD}`;
/**
 * A verb a release leads to as its gerund ("stop keeping …", "done preventing …"). The release gives up
 * only a verb it governs, so a bare verb after it ("I'm done keep the vocal bright") opens a clause of
 * its own. This is a lookahead holding a lookbehind: the verb ahead is a gerund and the release stands
 * right before it.
 */
const RELEASED_GERUND = String.raw`(?<=${UNREFUSED_RELEASE}\s+)${GERUND}`;
/**
 * A governing negation no release gives up, directly or through an intent: a release before the
 * negation gives up the "not" it leads to, so "stop trying to not keep the vocal bright" keeps it.
 */
const UNRELEASED_NEGATION = String.raw`(?<!${UNREFUSED_RELEASE}(?:\s+${RELEASED_INTENT})?\s+)${GOVERNING_NEGATION}`;
/**
 * Not where a negation governs the verb that follows: directly before it ("don't keep …", "don't stop
 * …") or through a permission ("you don't have to keep …", "there's no need to prevent …", "I don't
 * want to keep …", "don't bother keeping …", "don't worry about keeping …", "nobody needs to keep …",
 * "you no longer need to keep …"), past any adverb ("you don't really need to stop …"), and not where
 * a release gives the verb up, leading to it as its gerund ("stop keeping …", "forget about preventing
 * …") or through an intent ("stop trying to keep …", "stop caring about keeping …"). Either permits what a
 * keep, stop, prevent or leave names, so neither a reader nor the net reads a protection there. A
 * negation or permission governing the release refuses it, so the keep stands as it would alone
 * ("don't stop keeping …", "you don't have to stop keeping …"), and a release governing the negation
 * gives it up ("stop trying to not keep …"). A negation governing an earlier verb
 * ("without changing the tempo keep the vocal bright") permits nothing.
 */
export const NOT_PERMITTED = String.raw`(?<!${UNRELEASED_NEGATION})(?!${RELEASED_GERUND})(?<!${UNREFUSED_RELEASE}\s+${RELEASED_INTENT}\s+)`;
/**
 * The one leading words a move clause names its move through: "sound louder", "getting any wider",
 * "going brighter". The verb is never part of the object, so "sound louder" is a louder clause.
 */
export const DIRECTION_LEAD = String.raw`(?:${MOVE_LEAD_VERB}\s+)?(?:${ANY}\s+)?`;
const PLAIN_PREDICATE_WORD = words([...AUXILIARY_WORDS, ...PREDICATE_VERB_WORDS, ...COMPLEMENT_WORDS]);
/**
 * The words opening a predicate or its complement, which an object member never holds, so "the vocal
 * needs to be brighter" names "the vocal" and the words after it are a clause of its own.
 */
export const PREDICATE_WORD = String.raw`(?:${MODAL}|${LINKING_VERB}|${PLAIN_PREDICATE_WORD})`;
/**
 * The words opening a subordinate clause or a means: what follows one is the request's own move or
 * condition ("prevent clipping when I make the vocal louder", "stop it getting lost by making it
 * louder"), never what an earlier protection governs.
 */
export const SUBORDINATOR = words([
    'by',
    'when',
    'whenever',
    'if',
    SO,
    `${SO} ${THAT}`,
    TO_WORD,
    'because',
    AS_WORD,
    WHILE,
    'until',
    'before',
    'after',
    WITHOUT,
]);
/** The subject pronouns read as opening a clause of their own, whatever verb follows: "I make it louder". */
export const CLAUSE_SUBJECT = words(['i', 'you', 'we', 'they', 'he', 'she']);

const NON_OBJECT_WORD = String.raw`(?:${ANY_BOUNDARY_WORD}|${COMPARATIVE_WORDS}|${PREDICATE_WORD}|${ANY_NEGATION})`;
/**
 * A word an object member may hold: never a boundary, a direction, a negation or a predicate word, so a
 * member never runs into the next clause ("The vocal is louder and the drums must not …").
 */
function objectWord(excluded: string): string {
    return String.raw`(?!(?:${NON_OBJECT_WORD}|${excluded})${WHOLE_WORD_END}|${CLAUSE_SEPARATOR})${WORD_CHARACTER}+`;
}
/** What matches no word, for an object member that excludes nothing beyond what every member excludes. */
const MATCHES_NOTHING = '(?!)';
/** A masked track name, a role or mix word, a pronoun, or a determiner and a short noun phrase. */
function objectMember(word: string): string {
    return String.raw`(?:${DETERMINER}(?:\s+${word}){1,3}?|${MASK_GLYPH}+|(?:${SCOPE_WORD}|${MIX_PRONOUN})\b)`;
}
export const OBJECT_MEMBER = objectMember(objectWord(MATCHES_NOTHING));
/** An object list's members join as directions do, by a comma, "and" or "or", or by an ampersand. */
const MEMBER_JOIN = String.raw`(?:${LIST_JOIN}|\s*${AMPERSAND}\s*)`;
/**
 * A list of objects. A conjunction continues it only before another member, so "the vocal and the
 * drums" is one list while "the vocal and brighten the drums" ends at "and"; "or" lists as "and" does,
 * since a clause naming either member holds both ("don't raise the level of the vocal or the drums").
 */
function objectMembers(member: string): string {
    return String.raw`${member}(?:${MEMBER_JOIN}${member})*`;
}
export const OBJECT_MEMBERS = objectMembers(OBJECT_MEMBER);
export const OBJECT_LIST = String.raw`(?<object>${OBJECT_MEMBERS})`;
/**
 * An aside naming nothing but an object, closed or not, which a clause before it never holds as its own
 * object: "don't touch the low end (vocal)", "don't make it louder (the vocal)".
 */
export const OBJECT_ONLY_ASIDE = String.raw`${OPENING_BRACKET}\s*${OBJECT_MEMBERS}\s*(?:[${CLOSING_BRACKET_MARKS}]|${CLAUSE_END})`;
/** The words opening an exception to what a protection names: "except the vocal", "apart from the drums". */
const EXCEPTION_LEAD = words([
    'except',
    'except for',
    'excepting',
    'excluding',
    'not including',
    'apart from',
    'aside from',
    'other than',
    'besides',
    'save for',
    'barring',
    'with the exception of',
]);
/**
 * "unless", which opens a condition rather than an exception: one naming an object excepts it ("unless
 * the vocal gets louder"), one naming none states when the protection holds ("unless I say otherwise").
 */
const CONDITION_LEAD = words(['unless']);
/** The words a permission an exception grants opens with: "the vocal may rise", "but the vocal can". */
const PERMISSION_MODAL = words([
    'may',
    CAN,
    'could',
    'might',
    `${IS} allowed to`,
    'are allowed to',
    `${IS} free to`,
    'are free to',
]);
/** The states an excepted object is left in: "the vocal aside", "vocal excepted". */
const EXCEPTED_STATE = words([
    'aside',
    'excepted',
    'excluded',
    'exempt',
    'exempted',
    'apart',
    'left out',
    'not included',
]);
/**
 * The prepositions an exception excepts a stretch of time or place by rather than an object: "except in
 * the chorus", "apart from during the bridge", "but not before the drop".
 */
const EXCEPTION_PREPOSITION = words(['in', ON_WORD, 'at', 'during', 'before', 'after', 'for', 'when']);
/**
 * Where an excepted object ends: before a predicate it takes ("except the drums can be louder", "unless
 * the vocal gets louder"), a stretch it is excepted in ("except the vocal in the chorus"), or the end of
 * the clause, so the object is read whole ("except the lead vocal").
 */
const EXCEPTED_OBJECT_END = String.raw`(?=\s+(?:${PREDICATE_WORD}|${BECOMING_VERB}s?|${EXCEPTION_PREPOSITION})${WORD_END}|${CLAUSE_END})`;
/** "only", which narrows the object an exception permits: "drums only may change", "only the drums can". */
const ONLY = words(['only']);
/**
 * What an exception word, a condition or a refusal excepts, its object captured under the group named:
 * a stretch of time or place ("in the chorus") or an object, "only" before it ("only the drums").
 */
const LISTED_GROUP = 'listed';
const CONDITIONED_GROUP = 'conditioned';
const REFUSED_GROUP = 'refused';
const PERMITTED_GROUP = 'permitted';
const EXCEPTED_GROUP = 'excepted';
/** The group a "but" captures the track or role it carves out under. */
export const SPARED_GROUP = 'spared';
/** The groups an exception's object is captured under, one per form of `EXCEPTION_AFTER` and `SPARING_EXCEPTION`. */
export const EXCEPTED_OBJECT_GROUPS = [
    LISTED_GROUP,
    CONDITIONED_GROUP,
    REFUSED_GROUP,
    PERMITTED_GROUP,
    EXCEPTED_GROUP,
    SPARED_GROUP,
];
function exceptedPart(group: string, objectEnd: string = EXCEPTED_OBJECT_END): string {
    return String.raw`(?:${EXCEPTION_PREPOSITION}${WORD_END}|(?:${ONLY}\s+)?(?<${group}>${OBJECT_MEMBERS})${objectEnd})`;
}
/**
 * Where an object a "but" carves out ends: a stretch it is carved out in, the state the clause keeps it
 * in ("keep the width of everything but the guitar the same") or the end of the clause, never a
 * predicate, which makes it the subject of a clause of its own ("keep everything bright but the vocal
 * is too loud").
 */
const SPARED_OBJECT_END = String.raw`(?=\s+(?:${EXCEPTION_PREPOSITION}|${HELD_STATE}|${LEFT_STATE})${WORD_END}|${CLAUSE_END})`;
/** The marks an exception after a protection may stand behind: a comma, a colon, a separator or a bracket. */
const EXCEPTION_MARK = String.raw`(?:\s*[,;:${OPENING_BRACKET_MARKS}]|\s*${CLAUSE_SEPARATOR})?\s*`;
/**
 * The rest of an exception's clause, short of a word that ends a clause ("and keep the vocal bright"),
 * so an exception never runs into the next clause.
 */
const EXCEPTION_TAIL = String.raw`(?:(?!\b${CLAUSE_BOUNDARY_WORD}\b)${SAME_CLAUSE_CHARACTER})*`;
/** An object a permission names, "only" before or after it: "only the drums", "drums only". */
const PERMITTED_OBJECT = String.raw`(?:${ONLY}\s+)?(?<${PERMITTED_GROUP}>${OBJECT_MEMBERS})(?:\s+${ONLY})?`;
/**
 * An exception right after a protection, to the end of its clause and any closing bracket: an exception
 * word before an object ("(except the vocal)", ", excluding the drums"), a stretch of time or place
 * ("except in the chorus") or anything else ("except harsh"); a condition naming an object or a stretch
 * ("unless the vocal gets louder"); an object or a stretch refused ("(not the vocal)", "but not in the
 * chorus"); a permission on an object ("(the vocal may rise)", "(but the vocal can)", "(drums only may
 * change)"); or an object left out ("— the vocal aside", ", vocal excepted"). The object is captured as
 * `listed`, `conditioned`, `refused`, `permitted` or `excepted`, so a reader can tell an exception of
 * part of the clause's scope from a statement about another scope ("keep the vocal bright, except the
 * drums can be louder"). A refused quality ("but not harsh", "but not too bright") and a condition naming
 * no object ("unless I say otherwise") match no exception.
 */
export const EXCEPTION_AFTER = String.raw`${EXCEPTION_MARK}(?:${EXCEPTION_LEAD}(?:\s+${exceptedPart(LISTED_GROUP)}|${WORD_END})|${CONDITION_LEAD}\s+${exceptedPart(CONDITIONED_GROUP)}|(?:${words([BUT])}\s+)?${words([NOT])}\s+${exceptedPart(REFUSED_GROUP)}|(?:${words([BUT])}\s+)?${PERMITTED_OBJECT}\s+${PERMISSION_MODAL}${WORD_END}|(?<${EXCEPTED_GROUP}>${OBJECT_MEMBERS})\s+${EXCEPTED_STATE}${CLAUSE_END})${EXCEPTION_TAIL}[${CLOSING_BRACKET_MARKS}]?`;
/**
 * A "but" carving an object out of the clause right before it: "don't make anything wider but the
 * vocal", "don't make the mix wider but the vocal". The object is captured as `spared`, and a reader
 * reads the "but" as an exception only where that object names a track or role, so "keep the mix wide
 * but warm" carves nothing out.
 */
export const SPARING_EXCEPTION = String.raw`${EXCEPTION_MARK}${words([BUT])}\s+${exceptedPart(SPARED_GROUP, SPARED_OBJECT_END)}${EXCEPTION_TAIL}[${CLOSING_BRACKET_MARKS}]?`;
/** The marks setting an exception off from its clause, which its quotation leaves out: ", except the vocal" quotes "except the vocal". */
export const EXCEPTION_EDGE_MARKS = new RegExp(
    String.raw`^(?:\s*[,;:${BRACKET_MARKS}]|\s*${CLAUSE_SEPARATOR})+|(?:[,;:${BRACKET_MARKS}]|${CLAUSE_SEPARATOR})+\s*$`,
    'gu'
);
/**
 * An exception or condition opening the clause right before a protection, its object captured as after
 * one: "except for the vocal, keep the mix …", "except in the chorus, keep the vocal bright".
 */
export const EXCEPTION_BEFORE = String.raw`\b(?:${EXCEPTION_LEAD}(?:\s+${exceptedPart(LISTED_GROUP)}|${WORD_END})|${CONDITION_LEAD}\s+${exceptedPart(CONDITIONED_GROUP)})${SAME_CLAUSE_CHARACTER}*(?:[,;:]|${CLAUSE_SEPARATOR})?\s*$`;
/** What separates the members of an object list, in the text and in the reading of its members. */
export const OBJECT_MEMBER_SEPARATOR = new RegExp(MEMBER_JOIN, 'u');
/** "than", which a comparison names its other scope after. */
const THAN = words(['than']);
/** A direction compared with another scope: "louder than the vocal", "quieter than the vocal". */
export const COMPARED_DIRECTION = String.raw`${DIRECTION}\s+${THAN}\b`;
/** Comparatives one clause applies to one object: "brighter and louder", "brighter, wider, or louder". */
export const DIRECTION_LIST = String.raw`(?<direction>${DIRECTION}(?:${LIST_JOIN}(?:${ANY}\s+)?${DIRECTION})*)`;

/** The verbs that open a clause of their own, which a continued move's object never holds. */
const CLAUSE_OPENING_VERB = String.raw`(?:${KEEP_VERBS}|${RELEASE_LEAD}|${STOPPING_WORD}|${AVOID_VERB})`;
/**
 * An ampersand, spaced or not, before a verb opening a clause of its own, which joins that clause as
 * "and" does: "keep the vocal bright&stop making the mix wider".
 */
export const CLAUSE_JOINING_AMPERSAND = String.raw`\s*${AMPERSAND}\s*(?=${CLAUSE_OPENING_VERB}${WORD_END})`;
/** A clause end, or an ampersand opening the next clause: "keep the mix from getting wider&keep the vocal bright". */
export const JOINED_CLAUSE_END = String.raw`(?:${CLAUSE_END}|(?=${CLAUSE_JOINING_AMPERSAND}))`;
/**
 * A keep continuing a move rather than holding: "keep widening the mix", "keep on widening", "keep
 * making the drums wider", "keep the vocal getting brighter". It asks for more of the move through a
 * gerund, and never reaches past a separator into the next clause's move. Its object is the thing that
 * moves, so it holds no verb opening a clause of its own and no quality the keep holds (`heldTerm`):
 * "keep the vocal bright getting louder", "keep the vocal bright stop turning it down" and "keep the
 * vocal bright keep making it wider" keep a quality, and the gerund opens a clause of its own. A finite
 * verb after the keep's object ("keep the vocal bright make the drums louder") continues nothing.
 */
function continuedMove(heldTerm: string): string {
    const object = objectMembers(objectMember(objectWord(String.raw`(?:${CLAUSE_OPENING_VERB}|${heldTerm})`)));
    return String.raw`${SAME_CLAUSE_SPACE}(?:${ON}${SAME_CLAUSE_SPACE})?(?:${object}${SAME_CLAUSE_SPACE})?(?=${GERUND})(?:${NOUN_VERB_ING}|${CAUSING_VERB}\b${SAME_CLAUSE_CHARACTER}*?${DIRECTION})`;
}
/**
 * A keep-type verb that holds what follows, never one continuing a move or one a negation permits. The
 * kept-quality reader and the net pass the one pattern of terms it holds, so a keep naming one is
 * never read as a move.
 */
export function holdingKeep(heldTerm: string): string {
    return String.raw`${NOT_PERMITTED}${KEEP_VERBS}${WORD_END}(?!${continuedMove(heldTerm)})`;
}
