import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { OBJECTIVE_METRIC_LABELS } from '../../objectiveMetricProjection';
import {
    DETERMINER,
    KEEP_VERBS,
    MASK_GLYPH,
    POSSESSIVE_DETERMINER,
    SUBORDINATOR,
    THE,
} from '../../perceptualConstraints/constraintClauseWords';
import { words } from '../../perceptualConstraints/words';
import { METRIC_COMPARATORS, readRequestMetricNumbers } from '../../readRequestMetricNumbers';
import {
    CONTROL_WORDS,
    KIND_NOUNS,
    LEVEL_CONTROL_WORDS,
    MIX_LEVEL_NOUNS,
    TRACK_KIND_NOUNS,
} from '../protectionObjectForms';
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
import { CLOSING_PHRASES } from './closingPhrases';
import {
    CURRENT_LEVEL_COMPARISON_PHRASES,
    CURRENT_LEVEL_PHRASES,
    OBJECT_COMPARISON_PHRASES,
} from './comparisonPhrases';
import { findPromptNumbers } from './findPromptNumbers';
import { BAR_WORD, BEAT_WORD, findRangePhrases } from './findRangePhrases';
import { REFERENCE_PLACEHOLDER } from './findReferencedIntentPhrase';
import { findTrailingRangePhrase } from './findTrailingRangePhrase';
import { getClauseIntentVocabulary } from './getClauseIntentVocabulary';
import { getPoliteCommandPrefixLength } from './getPoliteCommandPrefixLength';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { isGenericDeviceIntent } from './isGenericDeviceIntent';
import { LEVEL_DESTINATION_NOUNS } from './levelDestinationNouns';
import { MASKED_REFERENCE_PATTERN } from './maskProjectReferences';
import { namesOnlyNonTrackObject } from './namesOnlyNonTrackObject';
import { normalizePromptText } from './normalizePromptText';
import { CAUSE_OPENER_WORDS, REASON_OPENER_WORDS, SUBJECT_PURPOSE_OPENER_WORDS } from './reasonOpenerWords';
import { STRICT_COURTESY_CLAUSES } from './strictCourtesyClauses';

type GroundingCatalogEntry = ReturnType<typeof getExecutableAppActionGroundingCatalog>[number];

/**
 * Verbs that open a level whose own phrase follows the target: "make Drums 3 dB quieter". "Set" is one
 * too, read with the verbs that set any value.
 */
const LEVEL_CARRIER_VERBS: readonly string[] = ['make'];

/** The prepositions that join a level noun to the object it belongs to: "the volume on the Drums". */
const LEVEL_NOUN_PREPOSITIONS: ReadonlySet<string> = new Set(['of', 'on', 'for']);

const ARTICLE = words(Array.from(ARTICLES));

/**
 * Each word after the figure that may open a stated reason or purpose: "... down 3 dB because Keys is
 * too loud", "... so it sits back", "... to make room for Keys". A reason says why, never where, when
 * or on what, so it is read only for what it names.
 */
const REASON_OPENER_PATTERN = new RegExp(String.raw`\s+(?<opener>${words(REASON_OPENER_WORDS)})\b`, 'giu');

/** A word that opens a noun phrase rather than a clause: "to the send", "so the low band". */
const DETERMINER_PATTERN = new RegExp(String.raw`^(?:${ARTICLE}|${DETERMINER}|${POSSESSIVE_DETERMINER})$`, 'iu');

/**
 * Where a measured constraint opens after the figure: "... by 1 dB while keeping true peak below -1 dBTP".
 * Its figures are the metric reader's, never the level's.
 */
const CONSTRAINT_BOUNDARY_PATTERN = new RegExp(String.raw`\s+(?=${SUBORDINATOR}\s+${KEEP_VERBS}\b)`, 'iu');
const METRIC_COMPARATOR = words(METRIC_COMPARATORS);

const CLOSING_PHRASE_WORDS: readonly string[][] = CLOSING_PHRASES.map((phrase) =>
    normalizePromptText(phrase).split(' ')
);

/** The words a clip, device or parameter name may share with the level clause it stands in. */
const LEVEL_CLAUSE_OWN_WORDS: ReadonlySet<string> = new Set([...LEVEL_CONTROL_WORDS, ...CLOSING_PHRASE_WORDS.flat()]);

/** A unit of musical time a reason may name: "because it only needs two bars". */
const MUSICAL_TIME_PATTERN = new RegExp(String.raw`\b(?:${BAR_WORD}|${BEAT_WORD})\b`, 'iu');

/**
 * Where a comparison against another project object opens after the words it qualifies: "... down
 * 3 dB like Keys", "... relative to Keys". The object is the comparison's, never the level's.
 */
const OBJECT_COMPARISON_PATTERN = new RegExp(
    String.raw`\s+(?=${words(OBJECT_COMPARISON_PHRASES)}\s+(?:${THE}\s+)?(?:clip)?${MASK_GLYPH})`,
    'iu'
);

/**
 * Where a comparison against the level as it stands closes the clause: "... down 3 dB relative to the
 * current level", "... 3 dB quieter than before".
 */
const CURRENT_LEVEL_COMPARISON_PATTERN = new RegExp(
    String.raw`\s+(?=${words(CURRENT_LEVEL_COMPARISON_PHRASES)}\s+${words(CURRENT_LEVEL_PHRASES)}\s*$)`,
    'iu'
);

/** A word, and whether a project name the masking hid wrote it ("Mix" naming a device parameter). */
type ClauseWord = { kind: 'word'; word: string; inName: boolean };

type ClauseToken = { kind: 'reference'; start: number; end: number } | ClauseWord;

type LevelClause = {
    /** The clause with project references masked, character for character with `text`. */
    masked: string;
    text: string;
};

type ReadSpan = { start: number; end: number };

/** A reason opener after the figure: where it starts, where its word ends, and that word normalized. */
type ReasonOpener = ReadSpan & { word: string };

function readWords(text: string, inName: boolean): ClauseToken[] {
    return normalizePromptText(text)
        .split(' ')
        .filter((word) => word.length > 0)
        .map((word) => ({ kind: 'word', word, inName }));
}

/** The spans of `clause.masked[from, to)` the masking hid, in order. */
function findMaskedSpans(clause: LevelClause, from: number, to: number): ReadSpan[] {
    return Array.from(clause.masked.slice(0, to).matchAll(MASKED_REFERENCE_PATTERN), (span) => ({
        start: span.index,
        end: span.index + span[0].length,
    })).filter((span) => span.end > from);
}

/**
 * Whether a masked span is a reference. The mask writes a four-character clip name as `clip` alone, so
 * a span the masking left as the text wrote it is the word "clip". A span whose text is one of a level
 * clause's own words and names only a clip, device or parameter ("the volume of the Drums" beside a
 * Volume parameter, "in the mix" beside a Mix parameter) is that word: the clause names no such object
 * by it, and a request aimed at the object ("the Drums mix") still reads the word outside the level's.
 */
function isReference(clause: LevelClause, span: ReadSpan, context: ProjectContext): boolean {
    const text = clause.text.slice(span.start, span.end);
    if (text === clause.masked.slice(span.start, span.end)) {
        return false;
    }
    return !(LEVEL_CLAUSE_OWN_WORDS.has(normalizePromptText(text)) && namesOnlyNonTrackObject(text, context));
}

/** The masked references of `clause.masked[from, to)`, in order. */
function findReferences(clause: LevelClause, from: number, to: number, context: ProjectContext): ReadSpan[] {
    return findMaskedSpans(clause, from, to).filter((span) => isReference(clause, span, context));
}

/** A masked span as one whole reference, or as the words it is written in when it is no reference. */
function readSpan(clause: LevelClause, span: ReadSpan, context: ProjectContext): ClauseToken[] {
    if (isReference(clause, span, context)) {
        return [{ kind: 'reference', ...span }];
    }
    return readWords(clause.text.slice(span.start, span.end), true);
}

/** The words and whole references of `clause.masked[from, to)`, in order. */
function readTokens(clause: LevelClause, from: number, to: number, context: ProjectContext): ClauseToken[] {
    const { masked } = clause;
    const tokens: ClauseToken[] = [];
    let cursor = from;
    for (const span of findMaskedSpans(clause, from, to)) {
        tokens.push(...readWords(masked.slice(cursor, span.start), false));
        tokens.push(...readSpan(clause, span, context));
        cursor = span.end;
    }
    tokens.push(...readWords(masked.slice(cursor, to), false));
    return tokens;
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
        ...LEVEL_CONTROL_WORDS,
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
    return token?.kind === 'word' && LEVEL_CONTROL_WORDS.includes(token.word);
}

/** Whether a word is the level's own: one of its words or a verb that sets any value ("increase", "change"). */
function isLevelWord(word: string, levelWords: ReadonlySet<string>): boolean {
    return levelWords.has(word) || isGenericDeviceIntent(word);
}

/**
 * Whether a word before the figure is the level's own: one of its words, a preposition joining a level
 * noun to the target it belongs to ("the volume on the Drums"), or a kind or mix noun after a reference
 * ("the Strings track", "the Drums mix"). Each joins the target slot, so none is read after the figure,
 * which names none.
 */
function isHeadLevelWord(
    token: ClauseWord,
    previous: ClauseToken | undefined,
    levelWords: ReadonlySet<string>
): boolean {
    const { word } = token;
    return (
        isLevelWord(word, levelWords) ||
        (LEVEL_NOUN_PREPOSITIONS.has(word) && isLevelNoun(previous)) ||
        (previous?.kind === 'reference' && namesReferencedTrack(token))
    );
}

/**
 * Whether a word after a reference names that track: a kind noun, or a mix noun no device parameter's
 * name wrote ("the Drums mix" beside a Mix parameter names that parameter).
 */
function namesReferencedTrack(token: ClauseWord): boolean {
    if (isTrackKindNoun(token.word)) {
        return true;
    }
    return MIX_LEVEL_NOUNS.includes(token.word) && !token.inName;
}

/**
 * Whether the words before the figure are the level's own words around one target slot. The slot is
 * every masked reference the clause holds, or, where it holds none, one run of other words a reference
 * reading may still resolve ("raise the vocal by 2 dB" for a track called Vocals). Any other word
 * ("peak", "threshold", "only") may name another control or narrow the level, so the clause is not read.
 */
function readsLevelHead(tokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    const namesReference = tokens.some((token) => token.kind === 'reference');
    let slotRuns = 0;
    let previousIsSlot = false;
    for (const [index, token] of tokens.entries()) {
        if (token.kind === 'reference' || isHeadLevelWord(token, tokens[index - 1], levelWords)) {
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

/** Whether the tokens end on the words of `phrase`. */
function endsOnPhrase(tokens: readonly ClauseToken[], phrase: readonly string[]): boolean {
    const end = tokens.slice(-phrase.length);
    return (
        end.length === phrase.length &&
        end.every((token, index) => token.kind === 'word' && token.word === phrase[index])
    );
}

/** The tokens without the one closing phrase they may end on: "... by 3 dB if possible". */
function withoutClosingPhrase(tokens: readonly ClauseToken[]): readonly ClauseToken[] {
    const closing = CLOSING_PHRASE_WORDS.find((phrase) => endsOnPhrase(tokens, phrase));
    return closing === undefined ? tokens : tokens.slice(0, tokens.length - closing.length);
}

/** Whether the words after the figure are only the level's own words and a closing phrase, naming no object. */
function readsLevelTail(tokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    const read = withoutClosingPhrase(tokens);
    return read.every((token) => token.kind === 'word' && isLevelWord(token.word, levelWords));
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
    return readWords(masked, false).some(
        (token) =>
            token.kind === 'word' &&
            !LEVEL_CONTROL_WORDS.includes(token.word) &&
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
        findReferences(clause, span.start, span.end, context).every(
            (reference) => !namesOnlyNonTrackObject(clause.text.slice(reference.start, reference.end), context)
        )
    );
}

/**
 * Whether a constraint reads, in order, as a subordinator, a keep verb, an optional article, the name of
 * the first metric it states a figure for, a comparator and that figure, with nothing after it, so a
 * second metric figure refuses it as any other word after the first does: "while
 * keeping true peak below -1 dBTP". Anything else ("... below -1 dBTP on the send", "while keeping the
 * low band tame") may name another object or control, so it is not a measured constraint.
 */
function readsAsMetricConstraint(clause: LevelClause, span: ReadSpan): boolean {
    const text = clause.text.slice(span.start, span.end);
    const [metric] = readRequestMetricNumbers(text);
    if (metric === undefined) {
        return false;
    }
    const metricName = words([OBJECTIVE_METRIC_LABELS[metric.metricId]]);
    const opening = new RegExp(
        String.raw`^\s*${SUBORDINATOR}\s+${KEEP_VERBS}\s+(?:${ARTICLE}\s+)?${metricName}\s+${METRIC_COMPARATOR}\s*$`,
        'iu'
    );
    const closing = text.slice(metric.start + metric.token.length);
    return opening.test(text.slice(0, metric.start)) && normalizePromptText(closing).length === 0;
}

/** Whether the words up to `end` close on an amount qualifier the opener ends: the "so" of "or so". */
function closesAmountQualifier(masked: string, end: number): boolean {
    const read = ` ${normalizePromptText(masked.slice(0, end))}`;
    return AMOUNT_QUALIFIER_PHRASES.some((phrase) => phrase.includes(' ') && read.endsWith(` ${phrase}`));
}

/** Whether a token names where a level goes: a reference, a kind of object ("the send") or a band or the master. */
function namesLevelDestination(token: ClauseToken): boolean {
    if (token.kind === 'reference') {
        return true;
    }
    const singular = token.word.replace(/s$/u, '');
    return [token.word, singular].some((form) => KIND_NOUNS.has(form) || LEVEL_DESTINATION_NOUNS.includes(form));
}

/**
 * Whether what an opener opens reads as a reason. A cause always does. A purpose does only as a clause
 * of its own. A verb opener's first word is a verb ("to make room"), never a determiner or a reference
 * ("to Reverb", "to the low band"). A subject opener's subject is a word that is no determiner ("so it
 * sits back"), a reference more words follow ("so Drums sits back") or a determiner whose words name no
 * destination ("so the vocal sits"), never a bare reference ("so Vocals") or a destination ("so the low
 * band", "so the send"), which say where the level goes, never why.
 */
function opensReason(clause: LevelClause, opener: ReasonOpener, context: ProjectContext): boolean {
    if (CAUSE_OPENER_WORDS.includes(opener.word)) {
        return true;
    }
    const [first, ...rest] = readTokens(clause, opener.end, clause.masked.length, context);
    if (first === undefined) {
        return false;
    }
    const opensSubject = SUBJECT_PURPOSE_OPENER_WORDS.includes(opener.word);
    if (first.kind === 'reference') {
        return opensSubject && rest.length > 0;
    }
    if (!DETERMINER_PATTERN.test(first.word)) {
        return true;
    }
    return opensSubject && rest.length > 0 && !rest.some(namesLevelDestination);
}

/**
 * Where a stated reason opens after the figure, or null for none: the first reason opener that is no
 * amount's word ("or so") and opens a reason, kept only when the reason names nothing but tracks.
 */
function findReasonStart(clause: LevelClause, tailStart: number, context: ProjectContext): number | null {
    for (const match of clause.masked.slice(tailStart).matchAll(REASON_OPENER_PATTERN)) {
        const opener = {
            start: tailStart + match.index,
            end: tailStart + match.index + match[0].length,
            word: normalizePromptText(match.groups?.opener ?? ''),
        };
        if (closesAmountQualifier(clause.masked, opener.end)) {
            continue;
        }
        const span = { start: opener.start, end: clause.masked.length };
        return opensReason(clause, opener, context) && namesNothingButTracks(clause, span, context)
            ? opener.start
            : null;
    }
    return null;
}

/**
 * Where the words the level closes on end: at a stated reason that names nothing but tracks, at a
 * measured constraint on one metric figure, at a comparison against another object ("like Keys") or the
 * level as it stands ("than before"), at a protection the protection reader reads, or at the clause end.
 * A reason or constraint naming anything else is read as the clause itself, so its words refuse it.
 */
function findClosingEnd(clause: LevelClause, tailStart: number, context: ProjectContext): number {
    const { masked } = clause;
    const constraint = findBoundary(CONSTRAINT_BOUNDARY_PATTERN, masked, tailStart);
    const boundaries = [
        findReasonStart(clause, tailStart, context),
        constraint !== null && readsAsMetricConstraint(clause, { start: constraint, end: masked.length })
            ? constraint
            : null,
        findBoundary(OBJECT_COMPARISON_PATTERN, masked, tailStart),
        findBoundary(CURRENT_LEVEL_COMPARISON_PATTERN, masked, tailStart),
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
 * the level's own words, a closing phrase, a trailing range phrase where the action declares one
 * (`closesOnRange`), a stated reason that names nothing but tracks, a measured constraint, a comparison
 * or a protection. Any other figure inside what the clause reads is a word outside the level's own and
 * refuses it, while a constraint's "-1 dBTP" lies past what it reads and is the metric reader's. A
 * clause stating no decibel figure is no decibel level clause, so this reader passes it through and
 * leaves it to the readers of its own shape.
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
    const readClause = { ...clause, masked };
    const tailEnd = findClosingEnd(readClause, tailStart, context);
    const levelWords = getLevelClauseWords(entry, masked);
    const headTokens = readTokens(
        { ...clause, masked: withoutSourceFigures(masked, sources) },
        headStart,
        headEnd,
        context
    );
    return (
        sources.every((source) => source.index < figure.index) &&
        readsLevelHead(headTokens, levelWords) &&
        readsLevelTail(readTokens(readClause, tailStart, tailEnd, context), levelWords) &&
        headTokens.every(
            (token) =>
                token.kind === 'word' || !namesOnlyNonTrackObject(clause.text.slice(token.start, token.end), context)
        )
    );
}
