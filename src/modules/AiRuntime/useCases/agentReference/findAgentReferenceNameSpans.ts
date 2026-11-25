import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { ORDINAL_WORDS } from './ordinalWords';

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
 * same once case, diacritics and punctuation are folded ("Kick In" for "Kick (In)"), with its final
 * word in the other grammatical number ("the vocal" for Vocals), or by the words after the index word
 * that opens it ("the kick" for 01 Kick).
 */
export type AgentReferenceNameCloseness = 'typed' | 'folded' | 'number-form' | 'without-index';

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
 * ("hi-hat" and "Lead–Vocal" state Hi Hat and Lead Vocal, "hi hat" states Hi-Hat).
 */
const NAME_WORD_SPACE = /^[\p{Zs}\t_-]$/u;

/**
 * How much of the text past a position is read for a sibling name starting there: the longest sibling's length plus
 * room for the punctuation a joiner may run to between its words, so the read never scans to the end of the text.
 */
const FAR_SIDE_JOINER_SLACK = 256;

/** A run of the text between two words of a name, which the reading then accepts or refuses. */
const ANY_JOINER = '([^\\p{L}\\p{N}]+)';

/** The same run where the text may also write the two words as one: "Guitar2" for Guitar 2, "Bobs" for Bob's. */
const ANY_OR_NO_JOINER = '([^\\p{L}\\p{N}]*)';

/** A word of figures alone, which opens an indexed name such as "01 Kick". */
const INDEX_WORD = /^\p{N}+$/u;

/**
 * How far either side of a reading is read for the word beside it, so each reading costs the same
 * whatever the length of the text around it.
 */
const ADJACENT_WORD_WINDOW = 64;

/** The word closing the text, past any punctuation or space after it. */
const WORD_BEFORE = /([\p{L}\p{N}]+)[^\p{L}\p{N}]*$/u;

/** The word opening the text past any punctuation or space before it, and what follows that word. */
const WORD_AFTER = /^[^\p{L}\p{N}]*([\p{L}\p{N}]+)(.*)$/su;

/** A value unit right after a figure, which makes the figure a value rather than a position: "50%", "2 dB". */
const VALUE_UNIT = /^\s*(?:%|d\s?b(?![\p{L}\p{N}]))/u;

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

/**
 * One joiner a match of the name crossed, with the folded offsets where it starts and where the rest
 * of the match starts past it.
 */
type NameJoint = { joiner: string; nameSeparator: string; joinerStart: number; restStart: number };

/** The joiners of a match whose captures alternate word, joiner, word, in the order the name has them. */
function getNameJoints(match: RegExpExecArray, nameSeparators: readonly string[]): NameJoint[] {
    const pieces = match.slice(1);
    const joints: NameJoint[] = [];
    let position = match.index + (pieces[0] ?? '').length;
    for (let index = 1; index < pieces.length; index += 2) {
        const joiner = pieces[index] ?? '';
        const joinerStart = position;
        position += joiner.length;
        joints.push({
            joiner,
            nameSeparator: nameSeparators[(index - 1) / 2] ?? '',
            joinerStart,
            restStart: position,
        });
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

/**
 * Whether the text may write two neighbouring words of a name with nothing between them: across a
 * letter and a figure ("Guitar2", "808Kick"), or where the name's own separator is an apostrophe
 * ("Bobs" for Bob's). Two letters run together ("Bassguitar") never state two words.
 */
function mayRunTogether(before: string, after: string, nameSeparator: string): boolean {
    const letterThenFigure = /\p{L}$/u.test(before) && /^\p{N}/u.test(after);
    const figureThenLetter = /\p{N}$/u.test(before) && /^\p{L}/u.test(after);
    return letterThenFigure || figureThenLetter || nameSeparator === "'";
}

/** What the text is read as while one name is read in it. */
type NameReading = {
    text: string;
    /** The text folded one character at a time, so each folded offset maps back to the text. */
    folded: string;
    toTextOffset: (foldedOffset: number) => number;
    forms: AgentReferenceNameForms;
    /** The sibling names, less any that fold to the name read. */
    otherNames: readonly string[];
};

/** The sibling names that each state the whole text, read with no other name to stop their own joints. */
function getWholeNames(text: string, names: readonly string[], forms: AgentReferenceNameForms): string[] {
    return names.filter((name) =>
        findAgentReferenceNameSpans(text, name, forms, []).some((span) => span.start === 0 && span.end === text.length)
    );
}

/** The sibling name reading furthest into the text from its start, and where that reading ends. */
function readLongestNameAtStart(
    text: string,
    names: readonly string[],
    forms: AgentReferenceNameForms
): { name: string; end: number } | null {
    let longest: { name: string; end: number } | null = null;
    for (const name of names) {
        for (const span of findAgentReferenceNameSpans(text, name, forms, [])) {
            if (span.start === 0 && span.end > (longest?.end ?? 0)) {
                longest = { name, end: span.end };
            }
        }
    }
    return longest;
}

/**
 * The sibling names the text states one after another from `from`, across any punctuation or space,
 * reading no further than `until` needs, and where the last of them ends.
 */
function readSiblingNameChain(reading: NameReading, from: number, until: number): { names: string[]; end: number } {
    const farSideLength = Math.max(0, ...reading.otherNames.map((sibling) => sibling.length)) + FAR_SIDE_JOINER_SLACK;
    const names: string[] = [];
    let end = from;
    let position = from;
    while (position < until) {
        const next = readLongestNameAtStart(
            reading.text.slice(position, position + farSideLength),
            reading.otherNames,
            reading.forms
        );
        if (next === null) {
            break;
        }
        names.push(next.name);
        end = position + next.end;
        position = end + (/^[^\p{L}\p{N}]*/u.exec(reading.text.slice(end))?.[0].length ?? 0);
    }
    return { names, end };
}

/**
 * Whether a joint of a match reads as a break between listed siblings rather than inside the name:
 * the words before it are a sibling name by themselves, sibling names run from past it to at least
 * the end of the match, and those siblings are at least two different names.
 */
function breaksIntoSiblingList(reading: NameReading, match: RegExpExecArray, joint: NameJoint): boolean {
    const start = reading.toTextOffset(match.index);
    const end = reading.toTextOffset(match.index + match[0].length);
    const nearNames = getWholeNames(
        reading.text.slice(start, reading.toTextOffset(joint.joinerStart)),
        reading.otherNames,
        reading.forms
    );
    if (nearNames.length === 0) {
        return false;
    }
    const listed = readSiblingNameChain(reading, reading.toTextOffset(joint.restStart), end);
    return listed.end >= end && new Set([...nearNames, ...listed.names]).size > 1;
}

/** The forms of the first word a reading of the words must find: the first word, or the final one's number forms. */
function getFirstWordForms(tokens: readonly string[], forms: AgentReferenceNameForms): string[] {
    const firstWord = tokens[0];
    if (firstWord === undefined) {
        return [];
    }
    return tokens.length > 1 || forms === 'exact' ? [firstWord] : getNumberForms(firstWord);
}

/** The words a name an index word opens ("01 Kick") is also stated by, none for any other name. */
function getUnindexedWords(tokens: readonly string[]): readonly string[] {
    const [indexWord, ...words] = tokens;
    return indexWord !== undefined && words.length > 0 && INDEX_WORD.test(indexWord) ? words : [];
}

/**
 * Every match of the words, in order and in the forms the reading allows, joined across space, dashes,
 * the name's own punctuation, nothing where the words may run together, and any other punctuation
 * that breaks no list of siblings.
 */
function matchNameWords(
    reading: NameReading,
    tokens: readonly string[],
    separators: readonly string[]
): RegExpExecArray[] {
    const finalToken = tokens.at(-1);
    if (finalToken === undefined) {
        return [];
    }
    const finalForms = reading.forms === 'exact' ? [finalToken] : getNumberForms(finalToken);
    const words = [...tokens.slice(0, -1).map(escapeRegExp), `(?:${finalForms.map(escapeRegExp).join('|')})`];
    const needle = words
        .map((word, index) => {
            if (index === 0) {
                return `(${word})`;
            }
            const before = tokens[index - 1] ?? '';
            const joiner = mayRunTogether(before, tokens[index] ?? '', separators[index - 1] ?? '')
                ? ANY_OR_NO_JOINER
                : ANY_JOINER;
            return `${joiner}(${word})`;
        })
        .join('');
    const pattern = new RegExp(`${WORD_BOUNDARY_BEFORE}${needle}${WORD_BOUNDARY_AFTER}`, 'gu');
    return findAcceptedMatches(reading.folded, pattern, (match) =>
        getNameJoints(match, separators).every(
            (joint) =>
                joinsAsNameSeparator(joint.joiner, joint.nameSeparator) || !breaksIntoSiblingList(reading, match, joint)
        )
    );
}

/**
 * Whether a word reads as a position or a number: it holds a figure ("02", "2nd", "track2") or is an
 * ordinal word ("second"), unless a value unit follows it ("50%", "2 dB").
 */
function readsAsPosition(word: string, rest: string): boolean {
    if (ORDINAL_WORDS.includes(word)) {
        return true;
    }
    return /\p{N}/u.test(word) && !VALUE_UNIT.test(rest);
}

/**
 * Whether the word right before or right after the folded range, across any punctuation or space,
 * reads as a position or a number, which then states which of several indexed names is meant.
 */
function isBesidePosition(folded: string, start: number, end: number): boolean {
    const before = WORD_BEFORE.exec(folded.slice(Math.max(0, start - ADJACENT_WORD_WINDOW), start));
    const wordBefore = before?.[1] ?? '';
    if (before !== null && readsAsPosition(wordBefore, before[0].slice(wordBefore.length))) {
        return true;
    }
    const after = WORD_AFTER.exec(folded.slice(end, end + ADJACENT_WORD_WINDOW));
    return after !== null && readsAsPosition(after[1] ?? '', after[2] ?? '');
}

/**
 * The ranges stating a name an index word opens ("01 Kick") by the words after it, wherever no word
 * beside them reads as a position or a number, so "the kick" and "set kick to 50%" state 01 Kick
 * while "02: kick", "the 2nd kick", "the second kick", "track2 kick" and "kick 2" never do.
 */
function findUnindexedSpans(
    reading: NameReading,
    tokens: readonly string[],
    separators: readonly string[]
): AgentReferenceNameSpan[] {
    const words = getUnindexedWords(tokens);
    if (words.length === 0) {
        return [];
    }
    return matchNameWords(reading, words, separators.slice(1))
        .filter((match) => !isBesidePosition(reading.folded, match.index, match.index + match[0].length))
        .map((match): AgentReferenceNameSpan => ({
            start: reading.toTextOffset(match.index),
            end: reading.toTextOffset(match.index + match[0].length),
            closeness: 'without-index',
        }));
}

/**
 * Every range of the text that states the name: its words folded as normalizeAgentReferenceText folds
 * them, final sigma aside, in order, the final word in either grammatical number when the forms allow
 * it. Space, underscore and any dash join two of its words wherever the text has them ("hi hat",
 * "hi_hat" and "hi–hat" state Hi-Hat, "hi-hat" states Hi Hat), and nothing joins them across a letter
 * and a figure or where the name has an apostrophe ("Guitar2" states Guitar 2, "Bobs Guitar" Bob's
 * Guitar). Any other punctuation joins them where the name itself has it there ("Guitar L/R"), and
 * elsewhere too unless it breaks a list of siblings: the reading's words before it are a sibling name
 * by themselves, and sibling names run from right past it to at least where the reading ends, naming
 * at least two different siblings. So beside a Drums track and no Bus, "drums/bus" states Drums Bus;
 * beside a Guitar track and no Bass, "bass/guitar" states Bass Guitar; beside Kick, Snare and Kick/Snare
 * tracks, "kick/snare/room" states Kick Snare Room; and beside a Lead track, "Lead, Lead" states Lead
 * Lead; while beside Bass and Drums tracks "Bass & Drums", "Bass | Drums" and a bulleted list of the
 * two never state Bass Drums, nor beside Bass and Drum Bus tracks does "Bass & Drum Bus" state Bass
 * Drum. A name that an index word opens ("01 Kick") is also stated by its other words, least closely
 * of all, wherever no word beside them reads as a position or a number. A range the name as typed covers, both read
 * composed and with every dash as the hyphen, reads as typed and reaches as far as the typed name does,
 * short of the punctuation closing it, wherever the text goes on: "Kick (In)" reads Kick (In) more
 * closely than Kick In, "Hi–Hat" reads Hi-Hat more closely than Hi Hat, and "Lead?" in "mute Lead?!"
 * reads no further than Lead does.
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
    const foldedForPresence = foldCharacters(text);
    const statesFirstWord = (words: readonly string[]) =>
        getFirstWordForms(words, forms).some((form) => foldedForPresence.includes(form));
    if (!statesFirstWord(tokens) && !statesFirstWord(getUnindexedWords(tokens))) {
        return [];
    }
    const { transformed: folded, offsets } = transformWithOffsets(text, foldCharacters);
    const foldedName = tokens.join(' ');
    const reading: NameReading = {
        text,
        folded,
        toTextOffset: (foldedOffset) => offsets[foldedOffset] ?? text.length,
        forms,
        otherNames: siblingNames.filter((sibling) => normalizeName(sibling) !== foldedName),
    };
    const separators = getNameSeparators(name);
    const matches = matchNameWords(reading, tokens, separators);
    const typedRanges = matches.length > 0 ? findTypedRanges(text, name) : [];
    const spans = matches.map((match): AgentReferenceNameSpan => {
        const start = reading.toTextOffset(match.index);
        const end = reading.toTextOffset(match.index + match[0].length);
        const typedRange = typedRanges.find((typed) => typed.start <= start && end <= typed.end);
        if (typedRange !== undefined) {
            return { ...typedRange, closeness: 'typed' };
        }
        return { start, end, closeness: match.at(-1) === finalToken ? 'folded' : 'number-form' };
    });
    return [...spans, ...findUnindexedSpans(reading, tokens, separators)];
}
