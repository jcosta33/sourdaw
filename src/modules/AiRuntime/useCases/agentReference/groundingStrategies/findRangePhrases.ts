import { type ProjectContext } from '../../../models/ProjectContext';

import { resolveProjectRange, type StatedRange } from './resolveProjectRange';

/** The beats a range covers once the project resolves it. */
export type RangeBeats = { startBeat: number; endBeat: number };

/** One range phrase a request states: where it sits in the text and the beats it names. */
export type RangePhrase = RangeBeats & { start: number; end: number };

/** Punctuation and spacing a range phrase may close on. */
export const RANGE_CLOSING = String.raw`[\p{P}\s]*$`;

/** A figure a range phrase or its target states. */
export const RANGE_NUMBER = String.raw`\d+(?:\.\d+)?`;

const SECTION_CONNECTOR_PATTERN = /(?<=^|\s)(?:in|during)\s+/giu;

const BAR_RANGE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:over|across|in|from|during)\s+bars?\s+(?<start>\d+)\s*(?:to|through|-|–)\s*(?:bar\s+)?(?<end>\d+)`,
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
 * resolver finds, `over bars N to M`, or `over beats N to M` (`from beat N to beat M` alike). The
 * resolver decides what counts as a place, so a phrase names a range only when a range write would
 * resolve it. A section connector the bar form already read is not read again.
 */
export function findRangePhrases(text: string, context: ProjectContext): RangePhrase[] {
    const numeric = [
        ...findNumericRanges(text, BAR_RANGE_PATTERN, (startBar, endBar) => ({ startBar, endBar }), context),
        ...findNumericRanges(text, BEAT_RANGE_PATTERN, (startBeat, endBeat) => ({ startBeat, endBeat }), context),
    ];
    const sections = findSectionRanges(text, context).filter(
        (section) => !numeric.some((phrase) => phrase.start === section.start)
    );
    return [...numeric, ...sections].sort((left, right) => left.start - right.start);
}
