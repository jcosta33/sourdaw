import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { KEEP_VERBS, SUBORDINATOR } from '../../perceptualConstraints/constraintClauseWords';
import { readRequestMetricNumbers } from '../../readRequestMetricNumbers';
import { CONTROL_WORDS, TRACK_KIND_NOUNS } from '../protectionObjectForms';
import { protectionSlots } from '../readProtectionSlots';

import { AMOUNT_QUALIFIER_PHRASES } from './amountQualifierWords';
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
import { BAR_WORD, BEAT_WORD, findRangePhrases } from './findRangePhrases';
import { REFERENCE_PLACEHOLDER } from './findReferencedIntentPhrase';
import { findTrailingRangePhrase } from './findTrailingRangePhrase';
import { getClauseIntentVocabulary } from './getClauseIntentVocabulary';
import { getPoliteCommandPrefixLength } from './getPoliteCommandPrefixLength';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { isGenericDeviceIntent } from './isGenericDeviceIntent';
import { namesOnlyNonTrackObject } from './namesOnlyNonTrackObject';
import { normalizePromptText } from './normalizePromptText';
import { STRICT_COURTESY_CLAUSES } from './strictCourtesyClauses';

type GroundingCatalogEntry = ReturnType<typeof getExecutableAppActionGroundingCatalog>[number];

/** The nouns a level is named by: "the volume of the Drums", "the Drums fader". */
export const LEVEL_NOUNS: readonly string[] = ['gain', 'volume', 'fader', 'level'];

/** Verbs that open a level whose own phrase follows the target: "set Drums volume to", "make Drums 3 dB quieter". */
const LEVEL_CARRIER_VERBS: readonly string[] = ['set', 'make'];

/** The prepositions that join a level noun to the object it belongs to: "the volume on the Drums". */
const LEVEL_NOUN_PREPOSITIONS: ReadonlySet<string> = new Set(['of', 'on', 'for']);

/**
 * Where a stated reason or purpose opens after the figure: "... down 3 dB because Keys is too loud",
 * "... so it sits back", "... to make room for Keys". A reason says why, never where, when or on what,
 * so it is read only for what it names.
 */
const REASON_BOUNDARY_PATTERN = /\s+(?=(?:because|since|so|to)\b)/iu;

/**
 * Where a measured constraint opens after the figure: "... by 1 dB while keeping true peak below -1 dBTP".
 * Its figures are the metric reader's, never the level's.
 */
const CONSTRAINT_BOUNDARY_PATTERN = new RegExp(String.raw`\s+(?=${SUBORDINATOR}\s+${KEEP_VERBS}\b)`, 'iu');

/** A unit of musical time a reason may name: "because it only needs two bars". */
const MUSICAL_TIME_PATTERN = new RegExp(String.raw`\b(?:${BAR_WORD}|${BEAT_WORD})\b`, 'iu');

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

type ReadSpan = { start: number; end: number };

function readWords(text: string): ClauseToken[] {
    return normalizePromptText(text)
        .split(' ')
        .filter((word) => word.length > 0)
        .map((word) => ({ kind: 'word', word }));
}

/** The masked references of `masked[from, to)`, in order. */
function findReferences(masked: string, from: number, to: number): ReadSpan[] {
    return Array.from(masked.slice(0, to).matchAll(MASKED_REFERENCE_PATTERN), (reference) => ({
        start: reference.index,
        end: reference.index + reference[0].length,
    })).filter((reference) => reference.end > from);
}

/** The words and whole references of `masked[from, to)`, in order. */
function readTokens(masked: string, from: number, to: number): ClauseToken[] {
    const tokens: ClauseToken[] = [];
    let cursor = from;
    for (const reference of findReferences(masked, from, to)) {
        tokens.push(...readWords(masked.slice(cursor, reference.start)));
        tokens.push({ kind: 'reference', ...reference });
        cursor = reference.end;
    }
    tokens.push(...readWords(masked.slice(cursor, to)));
    return tokens;
}

function isWithin(number: PromptNumber, spans: readonly ReadSpan[]): boolean {
    return spans.some((span) => number.index >= span.start && number.index < span.end);
}

function splitPhraseWords(phrases: Iterable<string>): string[] {
    return Array.from(phrases).flatMap((phrase) => normalizePromptText(phrase).split(' '));
}

/**
 * The words a level clause of this action may state beside its target and figure: its own intent and
 * level phrases, the level nouns, the carriers, the figure's connectors and direction words, articles,
 * the words that qualify an amount or close a request, and courtesy. The intent vocabulary is the one
 * the clause's intent was resolved from, so no action gains a word by being read here.
 */
function getLevelClauseWords(entry: GroundingCatalogEntry, masked: string): ReadonlySet<string> {
    const vocabulary = getClauseIntentVocabulary(entry, getStatedDecibelLevelForms(masked), undefined);
    const phrases = [
        ...vocabulary.phrases,
        ...vocabulary.referencedPhrases.map((phrase) => phrase.replaceAll(REFERENCE_PLACEHOLDER, ' ')),
        ...QUIETER_SCOPE_PHRASES,
        ...LOUDER_SCOPE_PHRASES,
        ...AMOUNT_QUALIFIER_PHRASES,
        ...STRICT_COURTESY_CLAUSES,
    ];
    return new Set([
        ...splitPhraseWords(phrases),
        ...LEVEL_NOUNS,
        ...LEVEL_CARRIER_VERBS,
        ...LEVEL_DIRECTION_WORDS,
        ...ABSOLUTE_CONNECTORS,
        ...SOURCE_CONNECTORS,
        ...ARTICLES,
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
 * Whether a word is the level's own: one of its words, a verb that sets any value ("increase",
 * "change"), a preposition joining a level noun to its object ("the volume on the Drums"), or a kind
 * noun after a reference ("the Strings track").
 */
function isLevelWord(word: string, previous: ClauseToken | undefined, words: ReadonlySet<string>): boolean {
    return (
        words.has(word) ||
        isGenericDeviceIntent(word) ||
        (LEVEL_NOUN_PREPOSITIONS.has(word) && isLevelNoun(previous)) ||
        (isTrackKindNoun(word) && previous?.kind === 'reference')
    );
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
        if (token.kind === 'reference' || isLevelWord(token.word, tokens[index - 1], words)) {
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

/** Whether the words after the figure are only the level's own words, naming no object. */
function readsLevelTail(tokens: readonly ClauseToken[], words: ReadonlySet<string>): boolean {
    return tokens.every((token, index) => token.kind === 'word' && isLevelWord(token.word, tokens[index - 1], words));
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

function findBoundary(pattern: RegExp, masked: string, from: number): number | null {
    const boundary = pattern.exec(masked.slice(from));
    return boundary === null ? null : from + boundary.index;
}

/** Whether a mixer control other than the level is named: "the send", "the pan". */
function namesOtherControl(masked: string): boolean {
    return readWords(masked).some(
        (token) =>
            token.kind === 'word' &&
            !LEVEL_NOUNS.includes(token.word) &&
            [token.word, token.word.replace(/s$/u, '')].some((form) => CONTROL_WORDS.has(form))
    );
}

/**
 * Whether a stated reason names nothing the level could be about: no figure, no other mixer control,
 * no stretch of the song or unit of musical time, and no object other than a track ("because they are
 * buried").
 */
function namesNothingButTracks(clause: LevelClause, span: ReadSpan, context: ProjectContext): boolean {
    const masked = clause.masked.slice(span.start, span.end);
    return (
        findPromptNumbers(masked).length === 0 &&
        !namesOtherControl(masked) &&
        !MUSICAL_TIME_PATTERN.test(masked) &&
        findRangePhrases(clause.text.slice(span.start, span.end), context).length === 0 &&
        findReferences(clause.masked, span.start, span.end).every(
            (reference) => !namesOnlyNonTrackObject(clause.text.slice(reference.start, reference.end), context)
        )
    );
}

/** Whether every figure a constraint states is a measured figure the metric reader reads ("-1 dBTP"). */
function statesOnlyMetricFigures(clause: LevelClause, span: ReadSpan): boolean {
    const text = clause.text.slice(span.start, span.end);
    const metricSpans = readRequestMetricNumbers(text).map((number) => ({
        start: number.start,
        end: number.start + number.token.length,
    }));
    return findPromptNumbers(text).every((number) => isWithin(number, metricSpans));
}

/**
 * Where the words the level closes on end: at a stated reason that names nothing but tracks, at a
 * measured constraint whose figures are all the metric reader's, at a comparison against another
 * object ("like Keys"), at a protection the protection reader reads, or at the clause end. A reason or
 * constraint naming anything else is read as the clause itself, so its words refuse it.
 */
function findClosingEnd(clause: LevelClause, masked: string, tailStart: number, context: ProjectContext): number {
    const reason = findBoundary(REASON_BOUNDARY_PATTERN, masked, tailStart);
    const constraint = findBoundary(CONSTRAINT_BOUNDARY_PATTERN, masked, tailStart);
    const boundaries = [
        reason !== null && namesNothingButTracks(clause, { start: reason, end: masked.length }, context)
            ? reason
            : null,
        constraint !== null && statesOnlyMetricFigures(clause, { start: constraint, end: masked.length })
            ? constraint
            : null,
        findBoundary(COMPARISON_BOUNDARY_PATTERN, masked, tailStart),
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
    return Math.min(figureIndex, ...openings.filter((start): start is number => start !== null && start > headStart));
}

/**
 * Whether a clause stating a decibel figure reads as one level change of this action and nothing else,
 * in one shape: an optional polite carrier, the level's own words around one target slot, one decibel
 * figure the level lands on or moves by (beside the figures it starts `from`), and after it nothing but
 * the level's own words, a trailing range phrase where the action declares one (`closesOnRange`), a
 * stated reason that names nothing but tracks, a measured constraint, a comparison or a protection.
 * Any other figure inside what the clause reads is a word outside the level's own and refuses it, while
 * a constraint's "-1 dBTP" lies past what it reads and is the metric reader's. A clause stating no decibel figure is not a decibel level clause and is not read here.
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
    const figure = numbers.find((number) => !sources.includes(number) && getDecibelFigureEnd(masked, number) !== null);
    const tailStart = figure === undefined ? null : getDecibelFigureEnd(masked, figure);
    if (figure === undefined || tailStart === null) {
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
    const tailEnd = findClosingEnd(clause, masked, tailStart, context);
    const words = getLevelClauseWords(entry, masked);
    const headTokens = readTokens(withoutSourceFigures(masked, sources), headStart, headEnd);
    return (
        sources.every((source) => source.index < figure.index) &&
        readsLevelHead(headTokens, words) &&
        readsLevelTail(readTokens(masked, tailStart, tailEnd), words) &&
        headTokens.every(
            (token) =>
                token.kind === 'word' || !namesOnlyNonTrackObject(clause.text.slice(token.start, token.end), context)
        )
    );
}
