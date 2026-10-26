import { getTimeSignatureSegmentAtBeat } from '../models/TimeSignatureMap';

import { timeSignatureMapStore } from './timeSignatureMapStore';
import { transportStore } from './transportStore';

type ReadNextPhysicalBarBoundaryInput = {
    beat: number;
    /** Include a bar line exactly at beat, as a note end may close there. */
    includeCurrent: boolean;
};

const GRID_EPSILON = 1e-9;

function isValidMeter(numerator: number, denominator: number): boolean {
    return (
        Number.isInteger(numerator) &&
        numerator >= 1 &&
        numerator <= 32 &&
        Number.isInteger(denominator) &&
        denominator >= 1 &&
        denominator <= 32
    );
}

/** The next physical bar line; a meter change cuts the outgoing bar at its own beat. */
export function readNextPhysicalBarBoundary({ beat, includeCurrent }: ReadNextPhysicalBarBoundaryInput): number | null {
    const transport = transportStore.value;
    const map = timeSignatureMapStore.value;
    if (!transport || !map || !Number.isFinite(beat) || beat < 0) {
        return null;
    }
    if (!isValidMeter(transport.timeSignatureNumerator, transport.timeSignatureDenominator)) {
        return null;
    }
    if (
        map.changes.some(
            ({ beat: changeBeat, numerator, denominator }) =>
                !Number.isFinite(changeBeat) || changeBeat < 0 || !isValidMeter(numerator, denominator)
        )
    ) {
        return null;
    }

    const segment = getTimeSignatureSegmentAtBeat(
        map.changes,
        beat,
        transport.timeSignatureNumerator,
        transport.timeSignatureDenominator
    );
    const barLength = segment.numerator * segment.beatUnit;
    if (!Number.isFinite(barLength) || barLength <= 0) {
        return null;
    }

    const barsFromStart = (beat - segment.startBeat) / barLength;
    let barIndex = Math.floor(barsFromStart + GRID_EPSILON) + 1;
    if (includeCurrent) {
        barIndex = Math.ceil(barsFromStart - GRID_EPSILON);
    }
    const gridBoundary = segment.startBeat + barIndex * barLength;
    const boundary = Math.min(gridBoundary, segment.endBeat);
    if (!Number.isFinite(boundary) || boundary < beat - GRID_EPSILON || (!includeCurrent && boundary <= beat)) {
        return null;
    }
    return boundary;
}
