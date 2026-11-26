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
import { getSingularForm } from '../getSingularForm';
import {
    CONTROL_WORDS,
    KIND_NOUNS,
    LEVEL_CONTROL_WORDS,
    MIX_LEVEL_NOUNS,
    TRACK_KIND_NOUNS,
} from '../protectionObjectForms';
import { protectionSlots } from '../readProtectionSlots';
import { refinementCourtesy } from '../refinementCourtesy';

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
import { isLeftAsWritten } from './isLeftAsWritten';
import {
    DEVICE_CONTROL_WORDS,
    LEVEL_CARRIER_VERBS,
    LEVEL_NOUN_PREPOSITIONS,
    SONG_SECTION_NOUNS,
} from './levelClauseWords';
import { LEVEL_DESTINATION_NOUNS } from './levelDestinationNouns';
import { MASKED_REFERENCE_PATTERN } from './maskProjectReferences';
import { namesOnlyNonTrackObject } from './namesOnlyNonTrackObject';
import { normalizePromptText } from './normalizePromptText';
import { CAUSE_OPENER_WORDS, REASON_OPENER_WORDS, SUBJECT_PURPOSE_OPENER_WORDS } from './reasonOpenerWords';

type GroundingCatalogEntry = ReturnType<typeof getExecutableAppActionGroundingCatalog>[number];

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

const COURTESY_PHRASE_WORDS: readonly string[][] = Array.from(refinementCourtesy.strict, (phrase) =>
    normalizePromptText(phrase).split(' ')
);

/** The words a clip, device or parameter name may share with the level clause it stands in. */
const LEVEL_CLAUSE_OWN_WORDS: ReadonlySet<string> = new Set([...LEVEL_CONTROL_WORDS, ...CLOSING_PHRASE_WORDS.flat()]);

/** A unit of musical time a reason may name: "because it only needs two bars". */
const MUSICAL_TIME_PATTERN = new RegExp(String.raw`\b(?:${BAR_WORD}|${BEAT_WORD})\b`, 'iu');

/** The words of the measured metrics' names beside the level's own nouns: "peak", "loudness", "crest". */
const METRIC_NAME_WORDS: ReadonlySet<string> = new Set(
    splitPhraseWords(Object.values(OBJECTIVE_METRIC_LABELS)).filter((word) => !LEVEL_CONTROL_WORDS.includes(word))
);

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
    if (isLeftAsWritten(clause.text, clause.masked, span)) {
        return false;
    }
    const text = clause.text.slice(span.start, span.end);
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

/**
 * The words and whole references of `clause.masked[from, to)`, in order, a kind or mix noun right after a
 * reference ("the Vocals track", "the Drums mix") and a kind noun right before one ("the track Drums",
 * "channel Drums") read as part of it, since each names that same track.
 */
function readTokens(clause: LevelClause, from: number, to: number, context: ProjectContext): ClauseToken[] {
    const tokens = readSpanTokens(clause, from, to, context);
    return tokens.filter((token, index) => token.kind === 'reference' || !isPartOfReference(token, tokens, index));
}

function isPartOfReference(token: ClauseWord, tokens: readonly ClauseToken[], index: number): boolean {
    if (tokens[index - 1]?.kind === 'reference' && namesReferencedTrack(token)) {
        return true;
    }
    return tokens[index + 1]?.kind === 'reference' && !token.inName && isTrackKindNoun(token.word);
}

/** The words and whole references of `clause.masked[from, to)`, in order, each as written. */
function readSpanTokens(clause: LevelClause, from: number, to: number, context: ProjectContext): ClauseToken[] {
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
        ...refinementCourtesy.strict,
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

/** A word as written and, where it reads as a plural, its singular: "buses" as "buses" and "bus". */
function withSingularForm(word: string): string[] {
    const singular = getSingularForm(word);
    if (singular === null) {
        return [word];
    }
    return [word, singular];
}

/** A kind of track, one or several: "the Strings track", "the bass tracks". */
function isTrackKindNoun(word: string): boolean {
    return withSingularForm(word).some((form) => TRACK_KIND_NOUNS.has(form));
}

function isLevelNoun(token: ClauseToken | undefined): boolean {
    return token?.kind === 'word' && LEVEL_CONTROL_WORDS.includes(token.word);
}

/** Whether a word is the level's own: one of its words or a verb that sets any value ("increase", "change"). */
function isLevelWord(word: string, levelWords: ReadonlySet<string>): boolean {
    return levelWords.has(word) || isGenericDeviceIntent(word);
}

/**
 * Whether a word before the figure is the level's own where the clause masks no reference: one of its
 * words, or a preposition joining a level noun to the target it belongs to ("the volume of the vocal").
 */
function isHeadLevelWord(word: string, previous: ClauseToken | undefined, levelWords: ReadonlySet<string>): boolean {
    return isLevelWord(word, levelWords) || (LEVEL_NOUN_PREPOSITIONS.has(word) && isLevelNoun(previous));
}

/**
 * Whether a word names something other than how the level moves: a project object its name hides ("mix"
 * beside a Mix parameter), a kind of object or a destination ("clip", "send", "band", "master"), a mixer
 * control other than the level ("pan"), a measured metric ("peak") or a device's own control
 * ("threshold"). The level nouns name the fader itself, whatever object shares their name.
 */
function namesOtherThanLevel(token: ClauseWord): boolean {
    if (LEVEL_CONTROL_WORDS.includes(token.word)) {
        return false;
    }
    if (token.inName) {
        return true;
    }
    return withSingularForm(token.word).some(
        (form) =>
            KIND_NOUNS.has(form) ||
            LEVEL_DESTINATION_NOUNS.includes(form) ||
            CONTROL_WORDS.has(form) ||
            METRIC_NAME_WORDS.has(form) ||
            DEVICE_CONTROL_WORDS.includes(form)
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

/** An adverb of manner, which says how the level moves and names nothing: "turn Drums down gently". */
const MANNER_ADVERB_PATTERN = /^\p{L}{2,}ly$/u;

/**
 * Whether the words before the figure lead to one target, read in two stretches. Before the target the
 * reading is open: any word says how the level is asked for ("bump Drums up", "I'd like you to lower
 * Drums") unless it names something other than the level or may start a name no reference resolves.
 * Between the target and the figure it is closed: only the level's own words, a level noun's
 * preposition, a manner adverb and one closing phrase ("lower Drums in the mix by 3 dB"), so "Drums
 * trim" or "Drums automation" names something the level does not.
 */
function readsLevelHead(headTokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    const target = headTokens.findIndex((token) => token.kind === 'reference');
    if (target === -1) {
        return readsUnmaskedSlot(withoutFirstClosingPhrase(headTokens), levelWords);
    }
    const lead = headTokens.slice(0, target);
    const middle = withoutFirstClosingPhrase(headTokens.slice(target));
    return (
        holdsOneTarget(middle) &&
        !extendsTargetName(lead, levelWords) &&
        lead.every((token) => token.kind === 'word' && !namesOtherThanLevel(token)) &&
        readsLevelMiddle(middle, levelWords)
    );
}

/**
 * Whether the words between the target and the figure are only the level's own: its words, a level
 * noun's preposition ("Drums volume to"), or a manner adverb, none naming another object.
 */
function readsLevelMiddle(tokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    return tokens.every(
        (token, index) =>
            token.kind === 'reference' ||
            (!namesOtherThanLevel(token) &&
                (isHeadLevelWord(token.word, tokens[index - 1], levelWords) || MANNER_ADVERB_PATTERN.test(token.word)))
    );
}

/**
 * Whether a word written right before the target may be the start of a name the project does not hold
 * ("lower Acoustic Bass by 3 dB" where only Bass exists): a word that is neither the level's own, nor a
 * level noun's preposition ("the volume of Drums"), nor a determiner. Such a target names an object no
 * reference resolves, so the clause is not read.
 */
function extendsTargetName(lead: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    const before = lead.at(-1);
    return (
        before?.kind === 'word' &&
        !isHeadLevelWord(before.word, lead.at(-2), levelWords) &&
        !DETERMINER_PATTERN.test(before.word)
    );
}

/**
 * Whether the references of a head are one target: a single reference, or references only list
 * punctuation separates ("Bass & Drums", "Bass / Drums"). A word between two references ("Drums on
 * Reverb") makes the second a second object.
 */
function holdsOneTarget(tokens: readonly ClauseToken[]): boolean {
    const first = tokens.findIndex((token) => token.kind === 'reference');
    const last = tokens.findLastIndex((token) => token.kind === 'reference');
    return tokens.slice(first, last + 1).every((token) => token.kind === 'reference');
}

/**
 * Whether a head that masks no reference is the level's own words around one run of other words, the
 * slot a reference reading may still resolve ("raise the vocal by 2 dB" for a track called Vocals). With
 * no reference to say which words are the target, a second run ("raise the vocal on the snare") may name
 * a second object, so the clause is not read, and so is a word naming something other than the level
 * ("raise the vocal send by 3 dB").
 */
function readsUnmaskedSlot(tokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    if (tokens.some((token) => token.kind === 'word' && !isTrackKindNoun(token.word) && namesOtherThanLevel(token))) {
        return false;
    }
    let slotRuns = 0;
    let previousIsSlot = false;
    for (const [index, token] of tokens.entries()) {
        if (token.kind === 'word' && isHeadLevelWord(token.word, tokens[index - 1], levelWords)) {
            previousIsSlot = false;
            continue;
        }
        if (!previousIsSlot) {
            slotRuns += 1;
        }
        previousIsSlot = true;
    }
    return slotRuns <= 1;
}

/** Whether the words of `phrase` start at `index` of the tokens. */
function holdsPhraseAt(tokens: readonly ClauseToken[], index: number, phrase: readonly string[]): boolean {
    return phrase.every((word, offset) => {
        const token = tokens[index + offset];
        return token?.kind === 'word' && token.word === word;
    });
}

/**
 * The words without the first closing phrase they hold before the figure: "lower Drums overall by
 * 3 dB", "turn Drums up in the mix by 2 dB", "raise the vocal in the mix by 2 dB".
 */
function withoutFirstClosingPhrase(tokens: readonly ClauseToken[]): readonly ClauseToken[] {
    for (let index = 0; index < tokens.length; index += 1) {
        const phrase = CLOSING_PHRASE_WORDS.find((closing) => holdsPhraseAt(tokens, index, closing));
        if (phrase !== undefined) {
            return [...tokens.slice(0, index), ...tokens.slice(index + phrase.length)];
        }
    }
    return tokens;
}

/** Whether the tokens end on the words of `phrase`. */
function endsOnPhrase(tokens: readonly ClauseToken[], phrase: readonly string[]): boolean {
    const end = tokens.slice(-phrase.length);
    return (
        end.length === phrase.length &&
        end.every((token, index) => token.kind === 'word' && token.word === phrase[index])
    );
}

/** The tokens without the one phrase of `phrases` they may end on. */
function withoutEndingPhrase(
    tokens: readonly ClauseToken[],
    phrases: readonly (readonly string[])[]
): readonly ClauseToken[] {
    const ending = phrases.find((phrase) => endsOnPhrase(tokens, phrase));
    return ending === undefined ? tokens : tokens.slice(0, tokens.length - ending.length);
}

/**
 * The tokens without the one closing phrase they may end on and the courtesy on either side of it:
 * "... by 3 dB in the mix please", "... by 3 dB please, in the mix".
 */
function withoutClosingWords(tokens: readonly ClauseToken[]): readonly ClauseToken[] {
    const beforeCourtesy = withoutEndingPhrase(tokens, COURTESY_PHRASE_WORDS);
    return withoutEndingPhrase(withoutEndingPhrase(beforeCourtesy, CLOSING_PHRASE_WORDS), COURTESY_PHRASE_WORDS);
}

/**
 * Whether the words after the figure, up to where a reason, constraint, comparison or protection takes
 * over, are only the level's own, read closed: its words and amount qualifiers ("or so", "again"), a
 * closing phrase and courtesy ("right now", "thanks a lot"). Any other word ("at the end", "in the
 * highs", "for one measure") may say where or when the level applies, so the clause is not read.
 */
function readsLevelTail(tokens: readonly ClauseToken[], levelWords: ReadonlySet<string>): boolean {
    return withoutClosingWords(tokens).every(
        (token) => token.kind === 'word' && levelWords.has(token.word) && !namesOtherThanLevel(token)
    );
}

/**
 * Whether a stretch of the clause states a figure, a unit of musical time or a range of the song: "at
 * 200 Hz", "for 2 bars", "in Verse 2". Any of them says what the level is for or where it applies.
 */
function statesValueOrStretch(clause: LevelClause, span: ReadSpan, context: ProjectContext): boolean {
    const masked = clause.masked.slice(span.start, span.end);
    return (
        findPromptNumbers(masked).length > 0 ||
        MUSICAL_TIME_PATTERN.test(masked) ||
        findRangePhrases(clause.text.slice(span.start, span.end), context).length > 0
    );
}

/**
 * The words that name a stretch of the song: a kind of section ("the chorus") and each word of the
 * project's own section and marker names ("the big moment").
 */
function getStretchWords(context: ProjectContext): ReadonlySet<string> {
    const sectionNames = context.sections?.map((section) => section.name) ?? [];
    const markerNames = context.markers?.map((marker) => marker.name) ?? [];
    const placeNames = [...sectionNames, ...markerNames];
    return new Set([...SONG_SECTION_NOUNS, ...splitPhraseWords(placeNames)].filter((word) => word.length > 0));
}

/**
 * Whether the words name a stretch of the song rather than how the level moves. A stretch word the level
 * also states names a stretch only after a determiner ("in the drop"), so "drop Drums by 3 dB" and "turn
 * Drums up" beside a section called "Build Up" stay the level's own words.
 */
function namesStretchOfSong(
    tokens: readonly ClauseToken[],
    stretchWords: ReadonlySet<string>,
    levelWords: ReadonlySet<string>
): boolean {
    return tokens.some((token, index) => {
        if (token.kind !== 'word' || !withSingularForm(token.word).some((form) => stretchWords.has(form))) {
            return false;
        }
        const previous = tokens[index - 1];
        return !levelWords.has(token.word) || (previous?.kind === 'word' && DETERMINER_PATTERN.test(previous.word));
    });
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
            withSingularForm(token.word).some((form) => CONTROL_WORDS.has(form))
    );
}

/**
 * Whether a stated reason names nothing the level could be about: no figure, no other mixer control,
 * no stretch of the song or unit of musical time, and no object other than a track ("because they are
 * buried").
 */
function namesNothingButTracks(clause: LevelClause, span: ReadSpan, context: ProjectContext): boolean {
    return (
        !statesValueOrStretch(clause, span, context) &&
        !namesOtherControl(clause.masked.slice(span.start, span.end)) &&
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
    return withSingularForm(token.word).some((form) => KIND_NOUNS.has(form) || LEVEL_DESTINATION_NOUNS.includes(form));
}

/**
 * Whether a word is one of the words a track's or clip's name holds: an object written short of its
 * whole name ("to Drum" beside a Drum Bus track) may be where the level goes.
 */
function namesProjectObjectWord(word: string, context: ProjectContext): boolean {
    const names = context.tracks.flatMap((track) => [track.name, ...track.clips.map((clip) => clip.name)]);
    return splitPhraseWords(names).includes(word);
}

/**
 * Whether the words after a subject opener, and after its determiner, read as a subject and what it
 * does: a track reference more words follow ("so Drums sits back", "so the Vocals sit better") or a
 * noun phrase ("so the vocal sits"), whose words name no destination either way.
 */
function readsAsSubjectClause(tokens: readonly ClauseToken[]): boolean {
    const [subject, ...predicate] = tokens;
    if (subject === undefined) {
        return false;
    }
    if (subject.kind === 'reference') {
        return predicate.length > 0 && !predicate.some(namesLevelDestination);
    }
    return !tokens.some(namesLevelDestination);
}

/**
 * Whether what an opener opens reads as a reason. A cause always does. A purpose does only as a clause
 * of its own. A verb opener's first word is a verb ("to make room"), never a determiner or a reference
 * ("to Reverb", "to the low band"). A subject opener's subject is a word that is no determiner ("so it
 * sits back") or a subject clause after any determiner, never a bare reference ("so Vocals", "so the
 * Vocals") or a destination ("so the low band", "so the send", "so the master"), which say where the
 * level goes, never why.
 */
function opensReason(clause: LevelClause, opener: ReasonOpener, context: ProjectContext): boolean {
    if (CAUSE_OPENER_WORDS.includes(opener.word)) {
        return true;
    }
    const [first, ...rest] = readTokens(clause, opener.end, clause.masked.length, context);
    if (first === undefined) {
        return false;
    }
    if (first.kind === 'word' && !DETERMINER_PATTERN.test(first.word)) {
        return !namesLevelDestination(first) && !namesProjectObjectWord(first.word, context);
    }
    if (!SUBJECT_PURPOSE_OPENER_WORDS.includes(opener.word)) {
        return false;
    }
    if (first.kind === 'reference') {
        return readsAsSubjectClause([first, ...rest]);
    }
    return readsAsSubjectClause(rest);
}

/** The first reason opener after the figure that is no amount's word ("or so"), or null for none. */
function findReasonOpener(clause: LevelClause, tailStart: number): ReasonOpener | null {
    for (const match of clause.masked.slice(tailStart).matchAll(REASON_OPENER_PATTERN)) {
        const opener = {
            start: tailStart + match.index,
            end: tailStart + match.index + match[0].length,
            word: normalizePromptText(match.groups?.opener ?? ''),
        };
        if (!closesAmountQualifier(clause.masked, opener.end)) {
            return opener;
        }
    }
    return null;
}

/**
 * Where a stated reason opens after the figure, or null for none: the first reason opener, kept only
 * when it opens a reason that names nothing but tracks.
 */
function findReasonStart(clause: LevelClause, tailStart: number, context: ProjectContext): number | null {
    const opener = findReasonOpener(clause, tailStart);
    if (opener === null) {
        return null;
    }
    const span = { start: opener.start, end: clause.masked.length };
    return opensReason(clause, opener, context) && namesNothingButTracks(clause, span, context) ? opener.start : null;
}

/**
 * Whether the figure is followed by a reason opener that opens no reason ("turn Drums up 2 dB so"): the
 * opener's word is then no word of the level, though "or so" shares it.
 */
function opensNoReason(clause: LevelClause, tailStart: number, context: ProjectContext): boolean {
    const opener = findReasonOpener(clause, tailStart);
    return opener !== null && !opensReason(clause, opener, context);
}

/**
 * Where a comparison against another project object opens after the figure, or null for none: kept only
 * when nothing but a closing phrase follows the object it compares against ("like Keys", "like Keys in
 * the mix"), since anything else ("like Keys on the send", "relative to Keys at -12 dB") may name a
 * control, a value or a stretch the comparison does not.
 */
function findObjectComparisonStart(clause: LevelClause, tailStart: number, context: ProjectContext): number | null {
    const start = findBoundary(OBJECT_COMPARISON_PATTERN, clause.masked, tailStart);
    if (start === null) {
        return null;
    }
    const [object] = findMaskedSpans(clause, start, clause.masked.length);
    if (object === undefined) {
        return null;
    }
    const [, ...after] = readTokens(clause, object.start, clause.masked.length, context);
    return withoutClosingWords(after).length === 0 ? start : null;
}

/**
 * Where the words the level closes on end: at a stated reason that names nothing but tracks, at a
 * measured constraint on one metric figure, at a comparison against another object ("like Keys") or the
 * level as it stands ("than before"), at a protection the protection reader reads, or at the clause end.
 * A reason, constraint or comparison naming anything else is read as the clause itself, so its words
 * refuse it.
 */
function findClosingEnd(clause: LevelClause, tailStart: number, context: ProjectContext): number {
    const { masked } = clause;
    const constraint = findBoundary(CONSTRAINT_BOUNDARY_PATTERN, masked, tailStart);
    const boundaries = [
        findReasonStart(clause, tailStart, context),
        constraint !== null && readsAsMetricConstraint(clause, { start: constraint, end: masked.length })
            ? constraint
            : null,
        findObjectComparisonStart(clause, tailStart, context),
        findBoundary(CURRENT_LEVEL_COMPARISON_PATTERN, masked, tailStart),
        findProtectionStart(masked, tailStart),
    ];
    return Math.min(masked.length, ...boundaries.filter((start): start is number => start !== null));
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
    // A protection opening on the head's first word ("keep Drums at -6 dB") is the whole clause's, never
    // one after the level's words, so only one opening past that word ends the head.
    const openings = [findProtectionStart(clause.masked.slice(0, figureIndex), headStart + 1)];
    if (input.closesOnRange) {
        openings.push(...findHeadRangeStarts(clause, figureIndex, context));
    }
    return Math.min(figureIndex, ...openings.filter((start): start is number => start !== null && start > headStart));
}

/**
 * Whether a clause stating a decibel figure reads as one level change of this action and nothing else:
 * one target, one decibel figure the level lands on or moves by (beside the figures it starts `from`),
 * and around them any words that say how the level is asked for. A word before or after the target and
 * figure is allowed unless it names an object or a control: a project reference other than the target, a
 * kind of object or a destination ("the send", "the low band", "the master"), a control or parameter, a
 * second figure, musical time or a stretch of the song. After the figure, a closing phrase, a trailing
 * range phrase where the action declares one (`closesOnRange`), a stated reason that names nothing but
 * tracks, a measured constraint, a comparison or a protection ends what the clause reads, while a clause
 * or comparison no reader reads refuses it. A constraint's "-1 dBTP" lies past what it reads and is the
 * metric reader's. A clause stating no decibel figure is no decibel level clause, so this reader passes
 * it through and leaves it to the readers of its own shape.
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
    return (
        sources.every((source) => source.index < figure.index) &&
        !opensNoReason(readClause, tailStart, context) &&
        readsHeadAndTail({
            context,
            head: {
                clause: { ...clause, masked: withoutSourceFigures(masked, sources) },
                start: headStart,
                end: headEnd,
            },
            levelWords: getLevelClauseWords(entry, masked),
            tail: { clause: readClause, start: tailStart, end: findClosingEnd(readClause, tailStart, context) },
        })
    );
}

/** One stretch of a level clause, read from the clause it belongs to. */
type ClauseStretch = ReadSpan & { clause: LevelClause };

/**
 * Whether the words before and after the target and figure say only how the level is asked for: no
 * second figure, musical time or stretch of the song in either, the head leading to one target, and the
 * tail naming nothing other than the level.
 */
function readsHeadAndTail(input: {
    context: ProjectContext;
    head: ClauseStretch;
    levelWords: ReadonlySet<string>;
    tail: ClauseStretch;
}): boolean {
    const { context, head, levelWords, tail } = input;
    const headTokens = readTokens(head.clause, head.start, head.end, context);
    const tailTokens = readTokens(tail.clause, tail.start, tail.end, context);
    const stretchWords = getStretchWords(context);
    return (
        !statesValueOrStretch(head.clause, head, context) &&
        !statesValueOrStretch(tail.clause, tail, context) &&
        !namesStretchOfSong(headTokens, stretchWords, levelWords) &&
        !namesStretchOfSong(tailTokens, stretchWords, levelWords) &&
        readsLevelHead(headTokens, levelWords) &&
        readsLevelTail(tailTokens, levelWords) &&
        headTokens.every(
            (token) =>
                token.kind === 'word' ||
                !namesOnlyNonTrackObject(head.clause.text.slice(token.start, token.end), context)
        )
    );
}
