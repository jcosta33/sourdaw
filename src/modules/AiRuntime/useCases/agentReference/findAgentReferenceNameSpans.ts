import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

/** A range of the original text, `end` exclusive. */
export type AgentReferenceTextRange = { start: number; end: number };

/**
 * Which forms of a name a reading accepts: the exact forms the resolver binds a target by, or those
 * with the final word also in the other grammatical number, which the direct route leaves to its
 * approximate reading ("mute the drum" binds Drums only as a fuzzy match).
 */
export type AgentReferenceNameForms = 'exact' | 'with-number-forms';

/**
 * How closely a range states a name: as typed (case aside), the same once case, diacritics and
 * punctuation are folded ("Kick In" for "Kick (In)"), or with its final word in the other grammatical
 * number ("the vocal" for Vocals).
 */
export type AgentReferenceNameCloseness = 'typed' | 'folded' | 'number-form';

export type AgentReferenceNameSpan = AgentReferenceTextRange & { closeness: AgentReferenceNameCloseness };

const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

/** The text folded as normalizeAgentReferenceText folds case and diacritics, with each folded code unit's offset in the text. */
function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
    let folded = '';
    const offsets: number[] = [];
    let offset = 0;
    for (const character of text) {
        const foldedCharacter = character.normalize('NFKD').toLocaleLowerCase().replaceAll(/\p{M}/gu, '');
        folded += foldedCharacter;
        offsets.push(...Array.from({ length: foldedCharacter.length }, () => offset));
        offset += character.length;
    }
    offsets.push(offset);
    return { folded, offsets };
}

function getPluralForm(word: string): string {
    if (/(?:s|x|z|ch|sh)$/u.test(word)) {
        return `${word}es`;
    }
    if (/[^aeiou]y$/u.test(word)) {
        return `${word.slice(0, -1)}ies`;
    }
    return `${word}s`;
}

function getSingularForm(word: string): string | null {
    if (word.endsWith('ies')) {
        return `${word.slice(0, -3)}y`;
    }
    if (/(?:s|x|z|ch|sh)es$/u.test(word)) {
        return word.slice(0, -2);
    }
    if (/[^siu]s$/u.test(word)) {
        return word.slice(0, -1);
    }
    return null;
}

/** The word and, when it ends in a letter rather than a figure, its plural and its singular. */
function getNumberForms(word: string): string[] {
    if (!/\p{L}$/u.test(word)) {
        return [word];
    }
    const forms = [word, getPluralForm(word)];
    const singular = getSingularForm(word);
    if (singular !== null) {
        forms.push(singular);
    }
    return forms;
}

/** Every range of the text where the name occurs as typed, case aside, at word edges wherever the name has one. */
function findTypedRanges(text: string, name: string): AgentReferenceTextRange[] {
    const typed = name.trim();
    if (typed.length === 0) {
        return [];
    }
    const before = /^[\p{L}\p{N}]/u.test(typed) ? WORD_BOUNDARY_BEFORE : '';
    const after = /[\p{L}\p{N}]$/u.test(typed) ? WORD_BOUNDARY_AFTER : '';
    const pattern = new RegExp(`${before}${escapeRegExp(typed)}${after}`, 'giu');
    return Array.from(text.matchAll(pattern), (match) => ({ start: match.index, end: match.index + match[0].length }));
}

/**
 * Every range of the text that states the name: its words folded as normalizeAgentReferenceText folds
 * them, in order, any run of punctuation or space between them, the final word in either grammatical
 * number when the forms allow it. A range the name as typed covers reaches as far as the typed name
 * does, so "Kick (In)" states all of "Kick (In)".
 */
export function findAgentReferenceNameSpans(
    text: string,
    name: string,
    forms: AgentReferenceNameForms
): AgentReferenceNameSpan[] {
    const tokens = normalizeAgentReferenceText(name)
        .split(' ')
        .filter((token) => token.length > 0);
    const finalToken = tokens.at(-1);
    if (finalToken === undefined) {
        return [];
    }
    const finalForms = forms === 'exact' ? [finalToken] : getNumberForms(finalToken);
    const needle = [...tokens.slice(0, -1).map(escapeRegExp), `(?:${finalForms.map(escapeRegExp).join('|')})`].join(
        '[^\\p{L}\\p{N}]+'
    );
    const pattern = new RegExp(`${WORD_BOUNDARY_BEFORE}${needle}${WORD_BOUNDARY_AFTER}`, 'gu');
    const { folded, offsets } = foldWithOffsets(text);
    const typedRanges = findTypedRanges(text, name);
    return Array.from(folded.matchAll(pattern), (match): AgentReferenceNameSpan => {
        const start = offsets[match.index] ?? text.length;
        const end = offsets[match.index + match[0].length] ?? text.length;
        const typedRange = typedRanges.find((typed) => typed.start <= start && end <= typed.end);
        if (typedRange !== undefined) {
            return { ...typedRange, closeness: 'typed' };
        }
        const foldsToName = normalizeAgentReferenceText(text.slice(start, end)) === tokens.join(' ');
        return { start, end, closeness: foldsToName ? 'folded' : 'number-form' };
    });
}
