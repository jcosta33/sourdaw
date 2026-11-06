import { BEAT_EPSILON } from './TempoMap';
import { getBarBeatAtPosition, getTimeSignatureSegmentAtBeat, type TimeSignatureChange } from './TimeSignatureMap';

/** Display resolution: a quarter note holds four sixteenths. */
const SIXTEENTHS_PER_QUARTER = 4;

type MeterDefaults = {
    defaultNumerator: number;
    defaultDenominator: number;
};

/**
 * Display rule, shared by positions and lengths: a value shows the sixteenth it lies in (floor),
 * as DAW position counters do, so it never reads in a later bar than the ruler draws it. A value
 * within the tempo-map same-beat tolerance of a sixteenth boundary snaps onto it first, so float
 * noise just under a boundary does not drop a whole sixteenth.
 */
export function snapToSixteenthBoundary(beats: number): number {
    const nearest = Math.round(beats * SIXTEENTHS_PER_QUARTER) / SIXTEENTHS_PER_QUARTER;
    return Math.abs(beats - nearest) <= BEAT_EPSILON ? nearest : beats;
}

/** Whole sixteenths in `quarters`, the last one of a beat that is not a whole number of them included. */
function floorSixteenths(quarters: number): number {
    return Math.floor((quarters + BEAT_EPSILON) * SIXTEENTHS_PER_QUARTER);
}

/**
 * Timeline position as `bar.beat.sixteenth`, all 1-based (`8.4.3`), counted through the meter map.
 * Bar and beat come from the meter law the ruler uses; the sixteenth is the one containing the
 * position inside its metrical beat.
 */
export function formatBarBeatSixteenth(
    changes: readonly TimeSignatureChange[],
    position: number,
    { defaultNumerator, defaultDenominator }: MeterDefaults
): string {
    const snapped = snapToSixteenthBoundary(position);
    const { bar, beat } = getBarBeatAtPosition(changes, snapped, defaultNumerator, defaultDenominator);
    const segment = getTimeSignatureSegmentAtBeat(changes, snapped, defaultNumerator, defaultDenominator);
    const quartersIntoSegment = Math.max(0, snapped - segment.startBeat);
    const beatsIntoSegment = Math.floor(quartersIntoSegment / segment.beatUnit + BEAT_EPSILON);
    const quartersIntoBeat = Math.max(0, quartersIntoSegment - beatsIntoSegment * segment.beatUnit);
    return `${bar}.${beat}.${floorSixteenths(quartersIntoBeat) + 1}`;
}

export type BarBeatSixteenthLength = {
    bars: number;
    beats: number;
    sixteenths: number;
};

/**
 * Length as 0-based bars, beats and sixteenths, counted by walking from `startBeat` to the end
 * through the meter map: each stretch inside one meter contributes its whole bars, then whole
 * beats of that meter, then whole sixteenths, so the length agrees with the Start and End shown
 * beside it. Every part is an integer for any denominator, because a beat of `4 / denominator`
 * quarters need not hold a whole number of sixteenths.
 */
export function measureBarBeatSixteenthLength(
    changes: readonly TimeSignatureChange[],
    startBeat: number,
    lengthBeats: number,
    { defaultNumerator, defaultDenominator }: MeterDefaults
): BarBeatSixteenthLength {
    const start = snapToSixteenthBoundary(startBeat);
    const end = snapToSixteenthBoundary(startBeat + Math.max(0, lengthBeats));
    const length = { bars: 0, beats: 0, sixteenths: 0 };
    let cursor = start;
    while (cursor < end) {
        const segment = getTimeSignatureSegmentAtBeat(changes, cursor, defaultNumerator, defaultDenominator);
        const barLength = segment.numerator * segment.beatUnit;
        if (!(barLength > 0) || !(segment.endBeat > cursor)) {
            break;
        }
        const stop = Math.min(end, segment.endBeat);
        let remaining = stop - cursor;
        const bars = Math.floor(remaining / barLength + BEAT_EPSILON);
        remaining = Math.max(0, remaining - bars * barLength);
        const beats = Math.floor(remaining / segment.beatUnit + BEAT_EPSILON);
        remaining = Math.max(0, remaining - beats * segment.beatUnit);
        length.bars += bars;
        length.beats += beats;
        length.sixteenths += floorSixteenths(remaining);
        cursor = stop;
    }
    return length;
}

/** A measured length as `bars.beats.sixteenths` (`0.3.3`; a full 4/4 bar is `1.0.0`). */
export function formatBarBeatSixteenthLength({ bars, beats, sixteenths }: BarBeatSixteenthLength): string {
    return `${bars}.${beats}.${sixteenths}`;
}
