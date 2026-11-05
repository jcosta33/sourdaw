import { getBarBeatAtPosition, getTimeSignatureAtBeat, type TimeSignatureChange } from './TimeSignatureMap';

/** Display resolution: a quarter note holds four sixteenths. */
const SIXTEENTHS_PER_QUARTER = 4;
const TICKS_PER_METRICAL_BEAT = 480;
const FLOAT_EPSILON = 1e-9;

type MeterDefaults = {
    defaultNumerator: number;
    defaultDenominator: number;
};

// Display rule: anything finer than a sixteenth rounds to the nearest sixteenth.
function roundToSixteenth(beats: number): number {
    return Math.round(beats * SIXTEENTHS_PER_QUARTER) / SIXTEENTHS_PER_QUARTER;
}

/**
 * Timeline position as `bar.beat.sixteenth`, all 1-based (`8.4.4`), counted
 * through the meter map. The position rounds to the nearest sixteenth first so
 * a value just under a bar line reads as that bar's downbeat.
 */
export function formatBarBeatSixteenth(
    changes: readonly TimeSignatureChange[],
    position: number,
    { defaultNumerator, defaultDenominator }: MeterDefaults
): string {
    const rounded = roundToSixteenth(position);
    const { bar, beat, tick } = getBarBeatAtPosition(changes, rounded, defaultNumerator, defaultDenominator);
    const { denominator } = getTimeSignatureAtBeat(changes, rounded, defaultNumerator, defaultDenominator);
    const sixteenthsPerBeat = 16 / denominator;
    const sixteenth = Math.floor((tick / TICKS_PER_METRICAL_BEAT) * sixteenthsPerBeat + FLOAT_EPSILON);
    return `${bar}.${beat}.${sixteenth + 1}`;
}

/**
 * Length as `bars.beats.sixteenths` of duration, all 0-based (`0.3.3`, a full
 * 4/4 bar is `1.0.0`). Bars are sized by the meter governing `startBeat`; the
 * length rounds to the nearest sixteenth first.
 */
export function formatBarBeatSixteenthLength(
    changes: readonly TimeSignatureChange[],
    startBeat: number,
    lengthBeats: number,
    { defaultNumerator, defaultDenominator }: MeterDefaults
): string {
    const { numerator, denominator } = getTimeSignatureAtBeat(changes, startBeat, defaultNumerator, defaultDenominator);
    const sixteenthsPerBeat = 16 / denominator;
    const totalSixteenths = Math.round(roundToSixteenth(Math.max(0, lengthBeats)) * SIXTEENTHS_PER_QUARTER);
    const sixteenthsPerBar = numerator * sixteenthsPerBeat;
    const bars = Math.floor(totalSixteenths / sixteenthsPerBar);
    const intoBar = totalSixteenths - bars * sixteenthsPerBar;
    const beats = Math.floor(intoBar / sixteenthsPerBeat);
    const sixteenths = intoBar - beats * sixteenthsPerBeat;
    return `${bars}.${beats}.${sixteenths}`;
}
