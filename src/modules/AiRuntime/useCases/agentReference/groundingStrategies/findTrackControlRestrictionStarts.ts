import { trackControlRestrictionPatterns } from './hasTrackControlRestriction';

/** Where each restriction phrase begins in the text, in order, read with the same vocabulary. */
export function findTrackControlRestrictionStarts(text: string): number[] {
    const lowered = text.toLowerCase();
    return trackControlRestrictionPatterns
        .flatMap((pattern) => Array.from(lowered.matchAll(new RegExp(pattern.source, 'gu')), (match) => match.index))
        .toSorted((left, right) => left - right);
}
