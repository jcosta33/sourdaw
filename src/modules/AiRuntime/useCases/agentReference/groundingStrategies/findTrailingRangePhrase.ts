import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { getBarStartBeat } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

type StatedRange = Parameters<typeof resolveMusicalRange>[0]['range'];

/** Punctuation and spacing a range phrase may close on. */
const CLOSING = String.raw`[\p{P}\s]*$`;

const SECTION_CONNECTOR_PATTERN = /\s(?:in|during)\s+/giu;

const BAR_RANGE_PATTERN = new RegExp(
    String.raw`\s(?:over|across|in)\s+bars?\s+(?<start>\d+)\s*(?:to|through|-|–)\s*(?<end>\d+)${CLOSING}`,
    'iu'
);

const BEAT_RANGE_PATTERN = new RegExp(
    String.raw`\s(?:over|across)\s+beats?\s+(?<start>\d+(?:\.\d+)?)\s*(?:to|through|-|–)\s*(?<end>\d+(?:\.\d+)?)${CLOSING}`,
    'iu'
);

const TRAILING_PUNCTUATION_PATTERN = new RegExp(CLOSING, 'u');

function resolves(range: StatedRange, context: ProjectContext): boolean {
    return (
        resolveMusicalRange({
            range,
            sections: context.sections ?? [],
            markers: context.markers ?? [],
            tracks: context.tracks,
            barStartBeat: getBarStartBeat,
        }).kind === 'resolved'
    );
}

function findNumericRange(
    text: string,
    pattern: RegExp,
    toRange: (start: number, end: number) => StatedRange,
    context: ProjectContext
): number | null {
    const match = pattern.exec(text);
    const start = Number(match?.groups?.start);
    const end = Number(match?.groups?.end);
    if (match === null || !Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
    }
    return resolves(toRange(start, end), context) ? match.index : null;
}

/** The earliest `in <reference>` whose whole remainder names one section or marker the project holds. */
function findSectionRange(text: string, context: ProjectContext): number | null {
    for (const match of text.matchAll(SECTION_CONNECTOR_PATTERN)) {
        const reference = text.slice(match.index + match[0].length).replace(TRAILING_PUNCTUATION_PATTERN, '');
        if (reference.length > 0 && resolves({ section: reference }, context)) {
            return match.index;
        }
    }
    return null;
}

/**
 * Where a closing range phrase starts in `text`, or null when the text does not end on one: `in
 * <section>` naming a place the musical range resolver finds, `over bars N to M`, or `over beats N
 * to M`. The resolver decides what counts as a place, so a phrase names a range only when a range
 * write would resolve it.
 */
export function findTrailingRangePhrase(text: string, context: ProjectContext): number | null {
    return (
        findNumericRange(text, BAR_RANGE_PATTERN, (startBar, endBar) => ({ startBar, endBar }), context) ??
        findNumericRange(text, BEAT_RANGE_PATTERN, (startBeat, endBeat) => ({ startBeat, endBeat }), context) ??
        findSectionRange(text, context)
    );
}
