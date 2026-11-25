import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { TRACK_KIND_NOUNS } from '../protectionObjectForms';
import { protectionSlots } from '../readProtectionSlots';

import {
    ABSOLUTE_CONNECTORS,
    ARTICLES,
    classifyPromptDecibelFigures,
    DECIBEL_UNIT_PATTERN,
    LEVEL_DIRECTION_WORDS,
    LOUDER_SCOPE_PHRASES,
    type PromptNumber,
    QUIETER_SCOPE_PHRASES,
    SOURCE_CONNECTORS,
} from './classifyPromptDecibelFigures';
import { findPromptNumbers } from './findPromptNumbers';
import { findRangePhrases } from './findRangePhrases';
import { REFERENCE_PLACEHOLDER } from './findReferencedIntentPhrase';
import { findTrailingRangePhrase } from './findTrailingRangePhrase';
import { getClauseIntentVocabulary } from './getClauseIntentVocabulary';
import { getPoliteCommandPrefixLength } from './getPoliteCommandPrefixLength';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { namesOnlyNonTrackObject } from './namesOnlyNonTrackObject';
import { normalizePromptText } from './normalizePromptText';

type GroundingCatalogEntry = ReturnType<typeof getExecutableAppActionGroundingCatalog>[number];

/** The nouns a level is named by: "the volume of the Drums", "the Drums fader". */
export const LEVEL_NOUNS: readonly string[] = ['gain', 'volume', 'fader', 'level'];

/** Verbs that open a level whose own phrase follows the target: "set Drums volume to", "make Drums 3 dB quieter". */
const LEVEL_CARRIER_VERBS: readonly string[] = ['set', 'make'];

/** Where a stated reason opens after the words it explains: "... down 3 dB because Keys is too loud". */
export const RATIONALE_BOUNDARY_PATTERN = /\s+(?=(?:because|since|so|to|for|as|which|when|where)\b)/iu;

/**
 * Where a comparison against another project object opens after the words it qualifies: "... down
 * 3 dB like Keys", "... relative to Keys". The object is the comparison's, never the level's.
 */
const COMPARISON_BOUNDARY_PATTERN = /\s+(?=(?:like|relative\s+to|compared\s+(?:to|with))\s+(?:the\s+)?(?:clip)?□)/iu;

/** A project reference as the masking writes it: a clip name keeps its `clip` prefix. */
const MASKED_REFERENCE_PATTERN = /clip□+|□+/gu;

type ClauseToken = { kind: 'reference'; start: number; end: number } | { kind: 'word'; word: string };

type LevelClause = {
    /** The clause with project references masked, character for character with `text`. */
    masked: string;
    text: string;
};

function readWords(text: string): ClauseToken[] {
    return normalizePromptText(text)
        .split(' ')
        .filter((word) => word.length > 0)
        .map((word) => ({ kind: 'word', word }));
}

/** The words and whole references of `masked[from, to)`, in order. */
function readTokens(masked: string, from: number, to: number): ClauseToken[] {
    const tokens: ClauseToken[] = [];
    let cursor = from;
    for (const reference of masked.slice(0, to).matchAll(MASKED_REFERENCE_PATTERN)) {
        const end = reference.index + reference[0].length;
        if (end <= from) {
            continue;
        }
        tokens.push(...readWords(masked.slice(cursor, reference.index)));
        tokens.push({ kind: 'reference', start: reference.index, end });
        cursor = end;
    }
    tokens.push(...readWords(masked.slice(cursor, to)));
    return tokens;
}

/**
 * The words a level clause of this action may state beside its target and figure: its own intent and
 * level phrases, the level nouns, the carriers, the figure's connectors and direction words, articles
 * and `please`. The vocabulary is the one the clause's intent was resolved from, so no action gains a
 * word by being read here.
 */
function getLevelClauseWords(entry: GroundingCatalogEntry, masked: string): ReadonlySet<string> {
    const vocabulary = getClauseIntentVocabulary(entry, getStatedDecibelLevelForms(masked), undefined);
    const phrases = [
        ...vocabulary.phrases,
        ...vocabulary.referencedPhrases.map((phrase) => phrase.replaceAll(REFERENCE_PLACEHOLDER, ' ')),
        ...QUIETER_SCOPE_PHRASES,
        ...LOUDER_SCOPE_PHRASES,
    ];
    return new Set([
        ...phrases.flatMap((phrase) => normalizePromptText(phrase).split(' ')),
        ...LEVEL_NOUNS,
        ...LEVEL_CARRIER_VERBS,
        ...LEVEL_DIRECTION_WORDS,
        ...ABSOLUTE_CONNECTORS,
        ...SOURCE_CONNECTORS,
        ...ARTICLES,
        'please',
    ]);
}

/** A kind of track, one or several: "the Strings track", "the bass tracks". */
function isTrackKindNoun(word: string): boolean {
    return [word, word.replace(/e?s$/u, '')].some((form) => TRACK_KIND_NOUNS.has(form));
}

function isLevelNoun(token: ClauseToken | undefined): boolean {
    return token?.kind === 'word' && LEVEL_NOUNS.includes(token.word);
}

/**
 * Whether the words before the figure are the level's own words around one target slot. The slot is
 * every masked reference the clause holds, or, where it holds none, one run of other words a reference
 * reading may still resolve ("raise the vocal by 2 dB" for a track called Vocals). Any other word
 * ("peak", "threshold", "only") may name another control or narrow the level, so the clause is not read.
 */
function readsLevelHead(tokens: readonly ClauseToken[], words: ReadonlySet<string>): boolean {
    const namesReference = tokens.some((token) => token.kind === 'reference');
    let slotRuns = 0;
    let previousIsSlot = false;
    for (const [index, token] of tokens.entries()) {
        const previous = tokens[index - 1];
        const isLevelWord =
            token.kind === 'reference' ||
            words.has(token.word) ||
            (token.word === 'of' && isLevelNoun(previous)) ||
            (isTrackKindNoun(token.word) && previous?.kind === 'reference');
        if (isLevelWord) {
            previousIsSlot = false;
            continue;
        }
        if (!previousIsSlot) {
            slotRuns += 1;
        }
        previousIsSlot = true;
    }
    return namesReference ? slotRuns === 0 : slotRuns <= 1;
}

/** Where the figure's unit ends, or null for a number stated in no decibel unit. */
function getDecibelFigureEnd(masked: string, figure: PromptNumber): number | null {
    const unit = DECIBEL_UNIT_PATTERN.exec(masked.slice(figure.end));
    return unit === null ? null : figure.end + unit[0].length;
}

/** A figure the level starts from rather than lands on: "from -12 dB" in "set Vocals volume from -12 dB to -6 dB". */
function isSourceFigure(masked: string, figure: PromptNumber): boolean {
    const precedingWord = normalizePromptText(masked.slice(0, figure.index)).split(' ').at(-1) ?? '';
    return SOURCE_CONNECTORS.has(precedingWord) && getDecibelFigureEnd(masked, figure) !== null;
}

/** The masked text with each source figure written as blanks, so only its connector is left to read. */
function withoutSourceFigures(masked: string, sources: readonly PromptNumber[]): string {
    return sources.reduce((text, source) => {
        const end = getDecibelFigureEnd(text, source) ?? source.end;
        return `${text.slice(0, source.index)}${' '.repeat(end - source.index)}${text.slice(end)}`;
    }, masked);
}

/**
 * Where a protection the protection reader reads opens after `from`: its verb, prohibition or carve-out
 * ("except the selected track", "keep Strings unchanged"), or the `with` of "with the selected track
 * unchanged". What it protects is that reader's to decide once the request has grounded.
 */
function findProtectionStart(masked: string, from: number): number | null {
    const opened = protectionSlots.startRanges(masked).map((range) => range.start);
    const headless = protectionSlots
        .read(masked)
        .map((slot) => /\bwith\s+$/iu.exec(masked.slice(0, slot.start))?.index ?? slot.start);
    const starts = [...opened, ...headless].filter((start) => start >= from);
    return starts.length === 0 ? null : Math.min(...starts);
}

/**
 * Where a stated reason opens after `tailStart`, or null. A reason naming a stretch ("when the chorus
 * hits") holds the level over that stretch, so it opens no reason here and the clause is read to its end.
 */
function findRationaleStart(
    clause: LevelClause,
    masked: string,
    tailStart: number,
    context: ProjectContext
): number | null {
    const rationale = RATIONALE_BOUNDARY_PATTERN.exec(masked.slice(tailStart));
    if (rationale === null) {
        return null;
    }
    const start = tailStart + rationale.index;
    return findRangePhrases(clause.text.slice(start), context).length === 0 ? start : null;
}

function findComparisonStart(masked: string, tailStart: number): number | null {
    const comparison = COMPARISON_BOUNDARY_PATTERN.exec(masked.slice(tailStart));
    return comparison === null ? null : tailStart + comparison.index;
}

/**
 * Where the words the level closes on end: at a stated reason that names no stretch of the song
 * ("because Keys is too loud"), at a comparison against another object ("like Keys"), at a protection
 * the protection reader reads, or at the clause end.
 */
function findClosingEnd(clause: LevelClause, masked: string, tailStart: number, context: ProjectContext): number {
    const boundaries = [
        findRationaleStart(clause, masked, tailStart, context),
        findComparisonStart(masked, tailStart),
        findProtectionStart(masked, tailStart),
    ];
    return Math.min(masked.length, ...boundaries.filter((start) => start !== null));
}

/** Where each range phrase before the figure opens, for an action that declares a range. */
function findHeadRangeStarts(clause: LevelClause, figureIndex: number, context: ProjectContext): number[] {
    return findRangePhrases(clause.text.slice(0, figureIndex), context).map((phrase) => phrase.start);
}

/**
 * Where the words the level opens on end: at the figure, or earlier where a protection opens after the
 * first of them ("lower every audio track other than Vocals by 3 dB") or, for an action that declares
 * a range, where a range phrase opens ("lift Drum Bus in Chorus Two by 1.5 dB"). What follows belongs
 * to the protection or the range, whose own readers decide it.
 */
function findHeadEnd(input: {
    clause: LevelClause;
    closesOnRange: boolean;
    context: ProjectContext;
    figureIndex: number;
    headStart: number;
}): number {
    const { clause, context, figureIndex, headStart } = input;
    const openings = [findProtectionStart(clause.masked.slice(0, figureIndex), headStart + 1)];
    if (input.closesOnRange) {
        openings.push(...findHeadRangeStarts(clause, figureIndex, context));
    }
    return Math.min(figureIndex, ...openings.filter((start) => start !== null && start > headStart));
}

/**
 * Whether a clause stating a decibel figure reads as one level change of this action and nothing else,
 * in one shape: an optional polite carrier, the level's own words around one target slot, exactly one
 * figure the level lands on or moves by (beside at most the figures it starts `from`), and after it
 * nothing but the level's own words, a trailing range phrase where the action declares one
 * (`closesOnRange`), a stated reason that names no stretch of the song, or a protection. A clause
 * stating no decibel figure is not a decibel level clause and is not read here.
 *
 * Every masked reference is the slot, so one whose whole text names a clip, device, parameter or VCA
 * group and no track names that object, never a fader.
 */
export function readsAsLevelClause(input: {
    clause: LevelClause;
    closesOnRange: boolean;
    context: ProjectContext;
    entry: GroundingCatalogEntry;
}): boolean {
    const { clause, context, entry } = input;
    const rangeStart = input.closesOnRange ? findTrailingRangePhrase(clause.text, context) : null;
    const masked = clause.masked.slice(0, rangeStart ?? clause.masked.length);
    const numbers = findPromptNumbers(masked);
    if (classifyPromptDecibelFigures(masked, numbers).length === 0) {
        return true;
    }
    const sources = numbers.filter((number) => isSourceFigure(masked, number));
    const levelFigures = numbers.filter((number) => !sources.includes(number));
    const figure = levelFigures[0];
    const tailStart = figure === undefined ? null : getDecibelFigureEnd(masked, figure);
    if (levelFigures.length !== 1 || figure === undefined || tailStart === null) {
        return false;
    }
    const headStart = getPoliteCommandPrefixLength(masked);
    const headEnd = findHeadEnd({
        clause,
        closesOnRange: input.closesOnRange,
        context,
        figureIndex: figure.index,
        headStart,
    });
    const headTokens = readTokens(withoutSourceFigures(masked, sources), headStart, headEnd);
    const closingTokens = readTokens(masked, tailStart, findClosingEnd(clause, masked, tailStart, context));
    const words = getLevelClauseWords(entry, masked);
    return (
        sources.every((source) => source.index < figure.index) &&
        readsLevelHead(headTokens, words) &&
        closingTokens.every((token) => token.kind === 'word' && words.has(token.word)) &&
        headTokens.every(
            (token) =>
                token.kind === 'word' || !namesOnlyNonTrackObject(clause.text.slice(token.start, token.end), context)
        )
    );
}
