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
 * How closely a range states a name: as typed (case, composition and the form of a dash aside), the
 * same once case, diacritics and punctuation are folded ("Kick In" for "Kick (In)"), or with its final
 * word in the other grammatical number ("the vocal" for Vocals).
 */
export type AgentReferenceNameCloseness = 'typed' | 'folded' | 'number-form';

export type AgentReferenceNameSpan = AgentReferenceTextRange & { closeness: AgentReferenceNameCloseness };

const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

/**
 * The punctuation closing a typed match, which never lengthens what it reads: "Lead?" in "mute Lead?!".
 * A combining mark belongs to the letter before it, as in a decomposed "Café".
 */
const TRAILING_PUNCTUATION = /[^\p{L}\p{M}\p{N}]+$/u;

/**
 * What joins any two words of a name wherever the text has it, folded: a run of space on one line, the
 * underscore that stands for a space in identifiers and file names ("hi_hat"), or a dash of any kind
 * ("hi-hat" and "Lead–Vox" state Hi Hat and Lead Vox, "hi hat" states Hi-Hat).
 */
const NAME_WORD_SPACE = /^[\p{Zs}\t_-]$/u;

/** A run of the text between two words of a name, which the reading then accepts or refuses. */
const ANY_JOINER = '([^\\p{L}\\p{N}]+)';

/**
 * Lowercasing a whole word turns a closing sigma into ς while lowercasing it alone gives σ, so a name
 * and the text folded one character at a time would never agree on "ΟΔΟΣ".
 */
function foldFinalSigma(folded: string): string {
    return folded.replaceAll('ς', 'σ');
}

/**
 * Typographic and look-alike apostrophes (the backtick, the prime, and the okina and modifier letters
 * ʹ ʻ ʼ among them) and every dash are the separator a name types as ' or -: "Jose’s", "Bob`s",
 * "Oʻahu", "Hi–Hat".
 */
function foldTypographicSeparators(folded: string): string {
    return folded.replaceAll(/[`‘’‛′ʹʻʼ]/gu, "'").replaceAll(/\p{Pd}/gu, '-');
}

/**
 * Case and diacritics folded as normalizeAgentReferenceText folds them, final sigma aside, punctuation
 * kept with its typographic forms folded.
 */
function foldCharacters(value: string): string {
    return foldTypographicSeparators(
        foldFinalSigma(value.normalize('NFKD').toLocaleLowerCase().replaceAll(/\p{M}/gu, ''))
    );
}

/**
 * The name's words, its characters folded as the text's are first: ʹ ʻ ʼ are letters to
 * normalizeAgentReferenceText, so a name left unfolded keeps "Oʻahu" one word the folded text never has.
 */
function normalizeName(value: string): string {
    return normalizeAgentReferenceText(foldCharacters(value));
}

/** The folded punctuation and space between each pair of the name's words, in order. */
function getNameSeparators(name: string): string[] {
    return foldCharacters(name)
        .split(/[\p{L}\p{N}]+/u)
        .slice(1, -1);
}

/**
 * Whether the folded joiner is only word space, dashes and the punctuation the name's own separator
 * there has, so "Kick In" reads Kick (In) and "Guitar L-R" reads Guitar L/R.
 */
function joinsAsNameSeparator(joiner: string, nameSeparator: string): boolean {
    return Array.from(joiner).every(
        (character) => NAME_WORD_SPACE.test(character) || nameSeparator.includes(character)
    );
}

/** One joiner a match of the name crossed, with the folded offset where the rest of the match starts. */
type NameJoint = { joiner: string; nameSeparator: string; restStart: number };

/** The joiners of a match whose captures alternate word, joiner, word, in the order the name has them. */
function getNameJoints(match: RegExpExecArray, nameSeparators: readonly string[]): NameJoint[] {
    const pieces = match.slice(1);
    const joints: NameJoint[] = [];
    let position = match.index + (pieces[0] ?? '').length;
    for (let index = 1; index < pieces.length; index += 2) {
        const joiner = pieces[index] ?? '';
        position += joiner.length;
        joints.push({ joiner, nameSeparator: nameSeparators[(index - 1) / 2] ?? '', restStart: position });
        position += (pieces[index + 1] ?? '').length;
    }
    return joints;
}

/**
 * The consecutive pieces of a text, each transformed, joined, with each transformed code unit's offset
 * in the text at the start of the piece it came from.
 */
function transformWithOffsets(
    pieces: Iterable<string>,
    transform: (piece: string) => string
): { transformed: string; offsets: number[] } {
    let transformed = '';
    const offsets: number[] = [];
    let offset = 0;
    for (const piece of pieces) {
        const transformedPiece = transform(piece);
        transformed += transformedPiece;
        offsets.push(...Array.from({ length: transformedPiece.length }, () => offset));
        offset += piece.length;
    }
    offsets.push(offset);
    return { transformed, offsets };
}

/** A character with the combining marks that follow it, the most composition (NFC) joins. */
const COMPOSABLE_CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

/** A name as typed, compared composed and with every dash read as the hyphen: "Hi–Hat" types Hi-Hat. */
function typeCharacters(value: string): string {
    return value.normalize('NFC').replaceAll(/\p{Pd}/gu, '-');
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
 * has one, less any punctuation that closes it. Both are read composed and with every dash as the
 * hyphen, so neither "Hi–Hat" nor a decomposed "Café" reads a sibling Hi Hat or Cafe as typed.
 */
function findTypedRanges(text: string, name: string): AgentReferenceTextRange[] {
    const typed = typeCharacters(name.trim());
    if (typed.length === 0) {
        return [];
    }
    const before = /^[\p{L}\p{N}]/u.test(typed) ? WORD_BOUNDARY_BEFORE : '';
    const after = /[\p{L}\p{N}]$/u.test(typed) ? WORD_BOUNDARY_AFTER : '';
    const pattern = new RegExp(`${before}${escapeRegExp(typed)}${after}`, 'giu');
    const { transformed, offsets } = transformWithOffsets(text.match(COMPOSABLE_CLUSTER) ?? [], typeCharacters);
    const toTextOffset = (typedOffset: number): number => offsets[typedOffset] ?? text.length;
    return Array.from(transformed.matchAll(pattern), (match) => {
        const start = toTextOffset(match.index);
        return { start, end: getTypedRangeEnd(text, start, toTextOffset(match.index + match[0].length)) };
    });
}

/**
 * Every match of the global pattern the reading accepts. A refused match gives way to one starting
 * inside it, so a reading refused at one word may still start at the next.
 */
function findAcceptedMatches(
    folded: string,
    pattern: RegExp,
    accepts: (match: RegExpExecArray) => boolean
): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    for (let match = pattern.exec(folded); match !== null; match = pattern.exec(folded)) {
        if (accepts(match)) {
            matches.push(match);
        } else {
            pattern.lastIndex = match.index + 1;
        }
    }
    return matches;
}

/** Whether the text states any of the names, each read with no other name to stop its own joints. */
function statesAnyName(text: string, names: readonly string[], forms: AgentReferenceNameForms): boolean {
    return names.some((name) => findAgentReferenceNameSpans(text, name, forms, []).length > 0);
}

/** Whether the text starts with any of the names, each read with no other name to stop its own joints. */
function startsWithAnyName(text: string, names: readonly string[], forms: AgentReferenceNameForms): boolean {
    return names.some((name) => findAgentReferenceNameSpans(text, name, forms, []).some((span) => span.start === 0));
}

/**
 * Every range of the text that states the name: its words folded as normalizeAgentReferenceText folds
 * them, final sigma aside, in order, the final word in either grammatical number when the forms allow
 * it. Space, underscore and any dash join two of its words wherever the text has them ("hi hat",
 * "hi_hat" and "hi–hat" state Hi-Hat, "hi-hat" states Hi Hat). Any other punctuation joins them where
 * the name itself has it there ("Guitar L/R"), or where the rest of the reading past it names none of
 * the sibling names by itself and no sibling name starts right past it: beside a Drums track and no
 * Bus, "drums/bus" states Drums Bus, while beside Bass and Drums tracks "Bass & Drums", "Bass | Drums"
 * and a bulleted list of the two never state Bass Drums, nor beside a Drum Bus does "Bass & Drum Bus"
 * state Bass Drum. A range the name as typed covers, both read composed and with every dash as the
 * hyphen, reads as typed and reaches as far as the typed name does, short of the punctuation closing
 * it, wherever the text goes on: "Kick (In)" reads Kick (In) more closely than Kick In, "Hi–Hat" reads
 * Hi-Hat more closely than Hi Hat, and "Lead?" in "mute Lead?!" reads no further than Lead does.
 */
export function findAgentReferenceNameSpans(
    text: string,
    name: string,
    forms: AgentReferenceNameForms,
    siblingNames: readonly string[]
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
    const needle = words.map((word, index) => (index === 0 ? `(${word})` : `${ANY_JOINER}(${word})`)).join('');
    const pattern = new RegExp(`${WORD_BOUNDARY_BEFORE}${needle}${WORD_BOUNDARY_AFTER}`, 'gu');
    const { transformed: folded, offsets } = transformWithOffsets(text, foldCharacters);
    const toTextOffset = (foldedOffset: number): number => offsets[foldedOffset] ?? text.length;
    const nameSeparators = getNameSeparators(name);
    const otherNames = siblingNames.filter((sibling) => normalizeName(sibling) !== tokens.join(' '));
    const continuesName = (match: RegExpExecArray): boolean => {
        const end = toTextOffset(match.index + match[0].length);
        return getNameJoints(match, nameSeparators).every((joint) => {
            if (joinsAsNameSeparator(joint.joiner, joint.nameSeparator)) {
                return true;
            }
            const restStart = toTextOffset(joint.restStart);
            return (
                !statesAnyName(text.slice(restStart, end), otherNames, forms) &&
                !startsWithAnyName(text.slice(restStart), otherNames, forms)
            );
        });
    };
    const typedRanges = findTypedRanges(text, name);
    return findAcceptedMatches(folded, pattern, continuesName).map((match): AgentReferenceNameSpan => {
        const start = toTextOffset(match.index);
        const end = toTextOffset(match.index + match[0].length);
        const typedRange = typedRanges.find((typed) => typed.start <= start && end <= typed.end);
        if (typedRange !== undefined) {
            return { ...typedRange, closeness: 'typed' };
        }
        const foldsToName = normalizeName(text.slice(start, end)) === tokens.join(' ');
        return { start, end, closeness: foldsToName ? 'folded' : 'number-form' };
    });
}
