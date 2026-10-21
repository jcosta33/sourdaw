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

/** The punctuation closing a typed match, which never lengthens what it reads: "Lead?" in "mute Lead?!". */
const TRAILING_PUNCTUATION = /[^\p{L}\p{N}]+$/u;

/**
 * List punctuation and line breaks start another item ("Bass & Drums", "Bass; Drums", a bulleted
 * list), so a name's words are read across them only where the name itself has that character. None
 * of them needs escaping inside a character class.
 */
const LIST_SEPARATORS = ['&', '+', '/', ';', '.', ',', '!', '?', '\n', '\r'];

/**
 * Lowercasing a whole word turns a closing sigma into ς while lowercasing it alone gives σ, so a name
 * and the text folded one character at a time would never agree on "ΟΔΟΣ".
 */
function foldFinalSigma(folded: string): string {
    return folded.replaceAll('ς', 'σ');
}

/** Case and diacritics folded as normalizeAgentReferenceText folds them, final sigma aside, punctuation kept. */
function foldCharacters(value: string): string {
    return foldFinalSigma(value.normalize('NFKD').toLocaleLowerCase().replaceAll(/\p{M}/gu, ''));
}

function normalizeName(value: string): string {
    return foldFinalSigma(normalizeAgentReferenceText(value));
}

/** The folded punctuation and space between each pair of the name's words, in order. */
function getNameSeparators(name: string): string[] {
    return foldCharacters(name)
        .split(/[\p{L}\p{N}]+/u)
        .slice(1, -1);
}

/**
 * What may join two of the name's words in the text: any run of punctuation or space, but list
 * punctuation or a line break only where the name's own separator there has it.
 */
function getWordJoiner(nameSeparator: string): string {
    const refused = LIST_SEPARATORS.filter((separator) => !nameSeparator.includes(separator)).join('');
    return `[^\\p{L}\\p{N}${refused}]+`;
}

/** The text folded as normalizeName folds case and diacritics, with each folded code unit's offset in the text. */
function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
    let folded = '';
    const offsets: number[] = [];
    let offset = 0;
    for (const character of text) {
        const foldedCharacter = foldCharacters(character);
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

/**
 * The end of a typed match short of the punctuation that closes it, wherever the text goes on, so
 * "Lead?" in "mute Lead?!" and "Pad..." in "mute Pad...please" read no further than Lead and Pad do.
 */
function getTypedRangeEnd(text: string, start: number, end: number): number {
    const trailing = TRAILING_PUNCTUATION.exec(text.slice(start, end));
    return trailing === null ? end : start + trailing.index;
}

/**
 * Every range of the text where the name occurs as typed, case aside, at word edges wherever the name
 * has one, less any punctuation that closes it.
 */
function findTypedRanges(text: string, name: string): AgentReferenceTextRange[] {
    const typed = name.trim();
    if (typed.length === 0) {
        return [];
    }
    const before = /^[\p{L}\p{N}]/u.test(typed) ? WORD_BOUNDARY_BEFORE : '';
    const after = /[\p{L}\p{N}]$/u.test(typed) ? WORD_BOUNDARY_AFTER : '';
    const pattern = new RegExp(`${before}${escapeRegExp(typed)}${after}`, 'giu');
    return Array.from(text.matchAll(pattern), (match) => ({
        start: match.index,
        end: getTypedRangeEnd(text, match.index, match.index + match[0].length),
    }));
}

/**
 * Every range of the text that states the name: its words folded as normalizeAgentReferenceText folds
 * them, final sigma aside, in order, any run of punctuation or space between them except list
 * punctuation or a line break the name does not have there ("Bass & Drums" never states Bass Drums),
 * the final word in either grammatical number when the forms allow it. A range the name as typed
 * covers reads as typed and reaches as far as the typed name does, short of the punctuation closing
 * it, wherever the text goes on: "Kick (In)" reads Kick (In) more closely than Kick In, and "Lead?" in
 * "mute Lead?!" reads no further than Lead does.
 */
export function findAgentReferenceNameSpans(
    text: string,
    name: string,
    forms: AgentReferenceNameForms
): AgentReferenceNameSpan[] {
    const tokens = normalizeName(name)
        .split(' ')
        .filter((token) => token.length > 0);
    const finalToken = tokens.at(-1);
    if (finalToken === undefined) {
        return [];
    }
    const finalForms = forms === 'exact' ? [finalToken] : getNumberForms(finalToken);
    const words = [...tokens.slice(0, -1).map(escapeRegExp), `(?:${finalForms.map(escapeRegExp).join('|')})`];
    const separators = getNameSeparators(name);
    const needle = words
        .map((word, index) => (index === 0 ? word : `${getWordJoiner(separators[index - 1] ?? '')}${word}`))
        .join('');
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
        const foldsToName = normalizeName(text.slice(start, end)) === tokens.join(' ');
        return { start, end, closeness: foldsToName ? 'folded' : 'number-form' };
    });
}
