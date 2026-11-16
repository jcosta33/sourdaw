import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';

import { COMPARATIVE_WORDS } from './constraintDirections';

/** The words every constraint reader shares: scope words, clause boundaries, negations and objects. */
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

const LEADING_DETERMINER = /^(?:the|my|our|this|that)\s+/u;

export function normalizeObjectText(text: string): string {
    return text
        .toLowerCase()
        .replaceAll(/["'“”‘’]/gu, '')
        .replaceAll(/\s+/gu, ' ')
        .trim()
        .replace(LEADING_DETERMINER, '');
}

export const CLAUSE_END = String.raw`(?=\s*(?:$|[,.;:!?]|\b(?:and|but|while|so|then|please)\b))`;
export const QUALITY_VERBS = String.raw`(?:keep|keeping|preserve|preserving|maintain|maintaining|retain|retaining)`;
export const NEGATION = String.raw`(?:do\s+not|don['’]?t|never|without)`;
/** "isn't" and "is not" state a clause as a modal negation does: "the mix isn't louder". */
export const MODAL_NEGATION = String.raw`(?:must\s+not|mustn['’]?t|should\s+not|shouldn['’]?t|may\s+not|can\s*not|can['’]?t|does\s+not|doesn['’]?t|will\s+not|won['’]?t|is\s+not|isn['’]?t|are\s+not|aren['’]?t)`;
/** The object may stand before the verb only at the head of a clause, so it never swallows an earlier clause. */
export const CLAUSE_HEAD = String.raw`(?<=^|[,.;:!?]\s*|\b(?:and|but|while|so|then|please)\s+)`;

/**
 * A word an object member may hold: never a conjunction, a direction, a negation or a copula, so a
 * member never runs into the next clause ("The vocal is louder and the drums must not …").
 */
const WORD = String.raw`(?!(?:and|or|but|${COMPARATIVE_WORDS.join('|')}|is|are|be|not|never|without|cannot|do|does|will|must|should|may|can|don['’]?t|doesn['’]?t|won['’]?t|mustn['’]?t|shouldn['’]?t|can['’]?t|isn['’]?t|aren['’]?t)(?![\p{L}\p{N}'’]))[^\s,.;:!?]+`;
const MIX_PRONOUN = String.raw`(?:it|everything|anything)`;
/** The role and mix words an object member may open with, longest first, so "lead vocal" is one member. */
export const SCOPE_WORD = Array.from(ROLE_WORDS.keys())
    .concat(Array.from(MIX_WORDS))
    .toSorted((left, right) => right.length - left.length)
    .map((word) =>
        word
            .split(' ')
            .map(escapeRegExp)
            .join(String.raw`\s+`)
    )
    .join('|');
/** A masked track name, a role or mix word, a pronoun, or a determiner and a short noun phrase. */
export const OBJECT_MEMBER = String.raw`(?:(?:the|my|our|this|that)\s+${WORD}(?:\s+${WORD}){0,2}?|□+|(?:${SCOPE_WORD}|${MIX_PRONOUN})\b)`;
/** What separates the members of an object list, in the text and in the reading of its members. */
export const OBJECT_MEMBER_SEPARATOR = /\s*(?:,|&|\band\b|\bor\b)\s*/u;
/**
 * A list of objects. A conjunction continues it only before another member, so "the vocal and the
 * drums" is one list while "the vocal and brighten the drums" ends at "and"; "or" lists as "and" does,
 * since a clause naming either member holds both ("don't raise the level of the vocal or the drums").
 */
export const OBJECT_LIST = String.raw`(?<object>${OBJECT_MEMBER}(?:(?:\s*,\s*(?:and\s+)?|\s+(?:and|or)\s+|\s*&\s*)${OBJECT_MEMBER})*)`;
