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
import { normalizePhrase } from './normalizePhrase';
import { words } from './words';

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
const MIX_PRONOUN_WORDS = ['it', 'everything', 'anything'];
/** The pronouns that hold the mix while the request names no track or role before them. */
export const MIX_PRONOUNS: ReadonlySet<string> = new Set(MIX_PRONOUN_WORDS);
export const MIX_PRONOUN = words(MIX_PRONOUN_WORDS);
/** The role words alone: what makes a later "it" name no single scope. */
export const ROLE_WORD = words(Array.from(ROLE_WORDS.keys()));
/** The role and mix words an object member may open with, longest first, so "lead vocal" is one member. */
export const SCOPE_WORD = words([...ROLE_WORDS.keys(), ...MIX_WORDS]);

/** The marks that end a clause, one character class each way: a mark, and any character but one. */
const CLAUSE_MARKS = ',.;:!?';
export const CLAUSE_PUNCTUATION = `[${CLAUSE_MARKS}]`;
export const NOT_CLAUSE_PUNCTUATION = `[^${CLAUSE_MARKS}]`;
/** A character of a word: neither whitespace nor a clause mark. */
export const WORD_CHARACTER = String.raw`[^\s${CLAUSE_MARKS}]`;

/** The glyph a masked track name or quotation is read as, one per character. */
export const MASK_GLYPH = PROJECT_REFERENCE_MASK_GLYPH;

const THE_WORD = 'the';
export const DETERMINER = words([THE_WORD, 'my', 'our', 'this', 'that']);
/** The definite article alone, which a held noun list and a held state open with: "the level", "the same". */
export const THE = words([THE_WORD]);
/** The possessives a continued clause may open with: "and its width". */
export const POSSESSIVE_DETERMINER = words(['its', 'their']);
const LEADING_DETERMINER = new RegExp(String.raw`^${DETERMINER}\s+`, 'u');
/** A quotation mark or an apostrophe, which an object's name is read without. */
const QUOTE_MARK = new RegExp(`["“”‘]|${APOSTROPHE}`, 'gu');

export function normalizeObjectText(text: string): string {
    return normalizePhrase(text.replaceAll(QUOTE_MARK, '')).replace(LEADING_DETERMINER, '');
}

const ANY_WORD = 'any';
const SO = 'so';
/** The degree words a comparative or a measured word may carry: "any louder", "too bright". */
export const DEGREE_WORD = words([ANY_WORD, 'more', 'less', 'too', SO]);
/** "any" alone, which a comparative may carry ("any wider") and an object never opens with. */
export const ANY = words([ANY_WORD]);

const AND = 'and';
const OR = 'or';
const BUT = 'but';
const HARD_BOUNDARY_WORDS = [BUT, 'while', SO, 'then', 'please'];
/** The one word joining nouns and continued objects under one verb: "the level and the width". */
export const AND_WORD = AND;
/** A comma or "and" joining a later noun or object to the one before it: "the level, and the width". */
export const AND_JOIN = String.raw`(?:\s*,\s*(?:${AND}\s+)?|\s+${AND}\s+)`;
/** The words joining list members: "the vocal and the drums", "louder or brighter". */
export const LIST_JOINER = words([AND, OR]);
/** The words joining kept terms of one object: "keep the vocal bright but dynamic". */
export const TERM_JOINER = words([AND, BUT]);
/** The words that end a clause whatever follows them; "and" and "or" may instead continue a list. */
export const HARD_BOUNDARY_WORD = words(HARD_BOUNDARY_WORDS);
/** The words a readable clause ends at: "or" is not one, since it lists inside a clause. */
const CLAUSE_BOUNDARY_WORD = words([AND, ...HARD_BOUNDARY_WORDS]);
/** Every word a clause may open or end at. */
export const ANY_BOUNDARY_WORD = words([AND, OR, ...HARD_BOUNDARY_WORDS]);
export const CLAUSE_END = String.raw`(?=\s*(?:$|${CLAUSE_PUNCTUATION}|\b${CLAUSE_BOUNDARY_WORD}\b))`;
/** The object may stand before the verb only at the head of a clause, so it never swallows an earlier clause. */
export const CLAUSE_HEAD = String.raw`(?<=^|${CLAUSE_PUNCTUATION}\s*|\b${CLAUSE_BOUNDARY_WORD}\s+)`;
/** The prepositions an object follows a held noun or the low end by: "the level of the drums". */
export const OBJECT_PREPOSITION = words(['of', 'on', 'in']);
/** The low end, by either name, its words spaced or hyphenated: "the low end", "the bottom-end". */
export const LOW_END = String.raw`${words(['low', 'bottom'])}[\s-]+end`;

export const KEEP = words(['keep', 'keeping']);
const PRESERVING_VERB = words(['preserve', 'preserving', 'maintain', 'maintaining', 'retain', 'retaining']);
export const KEEP_VERBS = String.raw`(?:${KEEP}|${PRESERVING_VERB})`;
export const LEAVE_VERB = words(['leave', 'leaving']);
export const STOP_VERB = words(['stop', 'stopping', 'prevent', 'preventing']);
/** "avoid making it louder" governs what follows as a negation does. */
export const AVOID_VERB = words(['avoid', 'avoiding']);
/** The verbs a subject becomes a level through on its own: "the mix must not get louder". */
export const BECOMING_VERB = words(['get', 'getting', 'become', 'becoming']);
/** The verbs that make a quality become a level ("don't make it louder"), beside those a held noun takes. */
const MAKING_VERB = words(['make', 'making', 'let', 'letting']);
export const CAUSING_VERB = String.raw`(?:${MAKING_VERB}|${BECOMING_VERB})`;
/** The verbs linking a subject to how it sounds: "shouldn't be louder", "sounding bright". */
export const LINKING_VERB = words(['be', 'being', 'sound', 'sounding', 'feel', 'feeling', 'seem', 'seeming']);

/** "as", which a kept term ("as dynamic") and a kept state ("as it is") stand behind. */
export const AS = words(['as']);
/** The states a kept object stays in: "intact", "as it is". */
const UNCHANGED_STATE = String.raw`(?:${words(['unchanged', 'intact'])}|${AS}\s+(?:it\s+)?is)`;
/** The states only a left object stays in, beside those: "leave the low end alone". */
const LEFT_ONLY_STATE = words(['alone', 'untouched']);
/** Every state a left or kept object stays in: "leave the low end alone", "keep the low end intact". */
export const LEFT_STATE = String.raw`(?:${LEFT_ONLY_STATE}|${UNCHANGED_STATE})`;
/** "the same", which a held noun stays and a level is kept at: "keep the Keys at the same level". */
export const THE_SAME = String.raw`${THE}\s+same`;
/** The states a kept measured noun stays in: "keep the level the same", "where it is". */
export const HELD_STATE = String.raw`(?:${THE_SAME}|where\s+it\s+is|${UNCHANGED_STATE})`;

export const NEGATION = String.raw`(?:${words(['do not', 'never', 'without'])}|don${APOSTROPHE}?t)`;
const CAN = 'can';
const MODAL = words(['must', 'should', 'may', CAN, 'will']);
/** The contractions' stems that drop a letter of their modal: "can't", "won't". */
const SHORTENED_MODAL = words([CAN, 'won']);
/** "doesn't get louder" asks for a bound; "doesn't sound brighter" describes the sound as it is. */
const DOES_NEGATION = String.raw`(?:${words(['does not'])}|doesn${APOSTROPHE}?t)(?!\s+${LINKING_VERB}\b)`;
/**
 * A modal negation states a clause ("shouldn't be", "mustn't get", "can't be", "won't get"); a plain
 * copula negation ("isn't", "aren't", "wasn't") describes the sound as it is, so it is none.
 */
export const MODAL_NEGATION = String.raw`(?:${MODAL}\s*not|${MODAL}n${APOSTROPHE}?t|${SHORTENED_MODAL}${APOSTROPHE}?t|${DOES_NEGATION})`;
const NO_WORD = 'no';
const BARE_NEGATION = words([NO_WORD, 'not']);
/** "no" alone, before what it negates: "no louder", "no changes to the low end". */
export const NO = words([NO_WORD]);
const NEGATED_CONTRACTION = String.raw`\p{L}+n${APOSTROPHE}t`;
/** Any negation at all: one may permit a move a later keep or stop names ("you don't have to keep …"). */
export const ANY_NEGATION = String.raw`(?:${NEGATION}|${MODAL_NEGATION}|${BARE_NEGATION}|${NEGATED_CONTRACTION})`;

const AUXILIARY_WORDS = ['is', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did'];
const PREDICATE_VERB_WORDS = ['needs', 'need', 'wants', 'want', 'gets', 'got'];
const FROM_WORD = 'from';
const COMPLEMENT_WORDS = ['to', FROM_WORD];
/** "from" alone, which a keep, stop or prevent names its move after: "keep the mix from getting louder". */
export const FROM = words([FROM_WORD]);
const PLAIN_PREDICATE_WORD = words([...AUXILIARY_WORDS, ...PREDICATE_VERB_WORDS, ...COMPLEMENT_WORDS]);
/**
 * The words opening a predicate or its complement, which an object member never holds, so "the vocal
 * needs to be brighter" names "the vocal" and the words after it are a clause of its own.
 */
export const PREDICATE_WORD = String.raw`(?:${MODAL}|${LINKING_VERB}|${PLAIN_PREDICATE_WORD})`;

const NON_OBJECT_WORD = String.raw`(?:${ANY_BOUNDARY_WORD}|${COMPARATIVE_WORDS}|${PREDICATE_WORD}|${ANY_NEGATION})`;
/**
 * A word an object member may hold: never a boundary, a direction, a negation or a predicate word, so a
 * member never runs into the next clause ("The vocal is louder and the drums must not …").
 */
const WORD = String.raw`(?!${NON_OBJECT_WORD}${WHOLE_WORD_END})${WORD_CHARACTER}+`;
/** A masked track name, a role or mix word, a pronoun, or a determiner and a short noun phrase. */
export const OBJECT_MEMBER = String.raw`(?:${DETERMINER}\s+${WORD}(?:\s+${WORD}){0,2}?|${MASK_GLYPH}+|(?:${SCOPE_WORD}|${MIX_PRONOUN})\b)`;
const MEMBER_JOIN = String.raw`(?:\s*,\s*(?:${AND}\s+)?|\s+${LIST_JOINER}\s+|\s*&\s*)`;
/**
 * A list of objects. A conjunction continues it only before another member, so "the vocal and the
 * drums" is one list while "the vocal and brighten the drums" ends at "and"; "or" lists as "and" does,
 * since a clause naming either member holds both ("don't raise the level of the vocal or the drums").
 */
export const OBJECT_MEMBERS = String.raw`${OBJECT_MEMBER}(?:${MEMBER_JOIN}${OBJECT_MEMBER})*`;
export const OBJECT_LIST = String.raw`(?<object>${OBJECT_MEMBERS})`;
/** What separates the members of an object list, in the text and in the reading of its members. */
export const OBJECT_MEMBER_SEPARATOR = new RegExp(String.raw`\s*(?:,|&|\b${LIST_JOINER}\b)\s*`, 'u');
/** Comparatives one clause applies to one object: "brighter and louder", "louder or brighter". */
export const DIRECTION_LIST = String.raw`(?<direction>${DIRECTION}(?:\s+${LIST_JOINER}\s+(?:${ANY}\s+)?${DIRECTION})*)`;

/**
 * A keep continuing a move rather than holding: "keep widening the mix", "keep on widening", "keep
 * making the drums wider", "keep the vocal getting brighter". It asks for more of the move.
 */
const CONTINUED_MOVE = String.raw`\s+(?:on\s+)?(?:${OBJECT_MEMBERS}\s+)?(?:${NOUN_VERB_ING}|${CAUSING_VERB}\b${NOT_CLAUSE_PUNCTUATION}*?${DIRECTION})`;
/** A keep-type verb that holds what follows, never one continuing a move. */
export const HOLDING_KEEP = String.raw`${KEEP_VERBS}${WORD_END}(?!${CONTINUED_MOVE})`;
