import { type ProjectContext } from '../../../models/ProjectContext';

import { resolveProjectRange, type StatedRange } from './resolveProjectRange';

/** The beats a range covers once the project resolves it. */
export type RangeBeats = { startBeat: number; endBeat: number };

/** One range phrase a request states: where it sits in the text and the beats it names. */
export type RangePhrase = RangeBeats & { start: number; end: number };

/**
 * A single bar or the bars before a section that the musical range law refuses: where the phrase
 * sits and the law's own reason, so the request can be refused with it rather than as a mismatch.
 */
export type RefusedRangePhrase = { start: number; end: number; refusal: string };

export type StatedRangePhrase = RangePhrase | RefusedRangePhrase;

/** Punctuation and spacing a range phrase may close on. */
export const RANGE_CLOSING = String.raw`[\p{P}\s]*$`;

/** A figure a range phrase or its target states. */
export const RANGE_NUMBER = String.raw`\d+(?:\.\d+)?`;

const SECTION_CONNECTOR_PATTERN = /(?<=^|\s)(?:in|during)\s+/giu;

const BAR_RANGE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:over|across|in|from|during)\s+bars?\s+(?<start>\d+)\s*(?:to|through|-|–)\s*(?:bar\s+)?(?<end>\d+)`,
    'giu'
);

/** One bar on its own: "in bar 9", never the start of "bars 9 to 12", which the bar-range form reads. */
const SINGLE_BAR_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:in|at|on|over|across|during|for)\s+bar\s+(?<bar>\d+)(?!\d|\.\d|\s*(?:to|through|-|–)\s*(?:bar\s+)?\d)`,
    'giu'
);

/** The count words a request may state the bars before a section in; a digit string is read as it is. */
const COUNT_WORDS: Readonly<Record<string, number>> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
};

/** "the last 4 bars before": the section reference follows, read by the caller. */
const BARS_BEFORE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:in|over|across|during|for)\s+the\s+(?:last|final)\s+(?<count>\d+|${Object.keys(COUNT_WORDS).join('|')})\s+bars?\s+before\s+`,
    'giu'
);

const BEAT_RANGE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:over|across|from)\s+beats?\s+(?<start>${RANGE_NUMBER})\s*(?:to|through|-|–)\s*(?:beat\s+)?(?<end>${RANGE_NUMBER})`,
    'giu'
);

const TRAILING_PUNCTUATION_PATTERN = new RegExp(RANGE_CLOSING, 'u');

function resolveBeats(range: StatedRange, context: ProjectContext): RangeBeats | null {
    const resolution = resolveProjectRange(range, context);
    return resolution.kind === 'resolved' ? { startBeat: resolution.startBeat, endBeat: resolution.endBeat } : null;
}

function findNumericRanges(
    text: string,
    pattern: RegExp,
    toRange: (start: number, end: number) => StatedRange,
    context: ProjectContext
): RangePhrase[] {
    return [...text.matchAll(pattern)].flatMap((match) => {
        const beats = resolveBeats(toRange(Number(match.groups?.start), Number(match.groups?.end)), context);
        return beats === null ? [] : [{ ...beats, start: match.index, end: match.index + match[0].length }];
    });
}

/** The section references a reference may be, longest first: each whole-word prefix of the text. */
function getReferenceCandidates(remainder: string): string[] {
    const wordEnds = Array.from(remainder.matchAll(/\S+/gu), (word) => word.index + word[0].length);
    return wordEnds.reverse().flatMap((end) => {
        const candidate = remainder.slice(0, end);
        const unpunctuated = candidate.replace(TRAILING_PUNCTUATION_PATTERN, '');
        return unpunctuated === candidate || unpunctuated.length === 0 ? [candidate] : [candidate, unpunctuated];
    });
}

function readBarCount(raw: string): number {
    return COUNT_WORDS[raw.toLowerCase()] ?? Number(raw);
}

/** A phrase the law resolved to beats, or refused with its own reason. */
function toStatedPhrase(
    resolution: ReturnType<typeof resolveProjectRange>,
    start: number,
    end: number
): StatedRangePhrase {
    if (resolution.kind === 'resolved') {
        return { startBeat: resolution.startBeat, endBeat: resolution.endBeat, start, end };
    }
    return { start, end, refusal: resolution.reason };
}

function findSingleBars(text: string, context: ProjectContext): StatedRangePhrase[] {
    return [...text.matchAll(SINGLE_BAR_PATTERN)].map((match) => {
        const bar = Number(match.groups?.bar);
        return toStatedPhrase(
            resolveProjectRange({ startBar: bar, endBar: bar }, context),
            match.index,
            match.index + match[0].length
        );
    });
}

/**
 * Each "the last N bars before <section>". The reference is the longest whole-word run that names a
 * place, so a section whose own name carries a number ("Verse 2") is read whole and N comes only
 * from the count words. Once the section is found the law has the last word on the bars.
 */
function findBarsBefore(text: string, context: ProjectContext): StatedRangePhrase[] {
    return [...text.matchAll(BARS_BEFORE_PATTERN)].flatMap((match) => {
        const referenceStart = match.index + match[0].length;
        const barsBefore = readBarCount(match.groups?.count ?? '');
        for (const reference of getReferenceCandidates(text.slice(referenceStart))) {
            if (resolveProjectRange({ section: reference }, context).kind !== 'unknown-section') {
                const resolution = resolveProjectRange({ section: reference, barsBefore }, context);
                return [toStatedPhrase(resolution, match.index, referenceStart + reference.length)];
            }
        }
        return [];
    });
}

/** Each `in <reference>` whose longest whole-word reference names a place the project resolves. */
function findSectionRanges(text: string, context: ProjectContext): RangePhrase[] {
    return [...text.matchAll(SECTION_CONNECTOR_PATTERN)].flatMap((match) => {
        const referenceStart = match.index + match[0].length;
        for (const reference of getReferenceCandidates(text.slice(referenceStart))) {
            const beats = resolveBeats({ section: reference }, context);
            if (beats !== null) {
                return [{ ...beats, start: match.index, end: referenceStart + reference.length }];
            }
        }
        return [];
    });
}

/**
 * Every range phrase `text` states, in text order: `in <section>` naming a place the musical range
 * resolver finds, `over bars N to M`, `over beats N to M` (`from beat N to beat M` alike), `in bar N`
 * and `the last N bars before <section>`. The resolver decides what counts as a place, so a phrase
 * names a range only when a range write would resolve it; the exceptions are the last two forms,
 * which are unambiguous about what they ask and so are kept, carrying the law's reason, when it
 * refuses them. A section connector another form already read is not read again.
 */
export function findRangePhrases(text: string, context: ProjectContext): StatedRangePhrase[] {
    const numeric: StatedRangePhrase[] = [
        ...findSingleBars(text, context),
        ...findBarsBefore(text, context),
        ...findNumericRanges(text, BAR_RANGE_PATTERN, (startBar, endBar) => ({ startBar, endBar }), context),
        ...findNumericRanges(text, BEAT_RANGE_PATTERN, (startBeat, endBeat) => ({ startBeat, endBeat }), context),
    ];
    const sections = findSectionRanges(text, context).filter(
        (section) => !numeric.some((phrase) => phrase.start === section.start)
    );
    return [...numeric, ...sections].sort((left, right) => left.start - right.start);
}
