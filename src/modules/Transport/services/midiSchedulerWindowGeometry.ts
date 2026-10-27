import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

type GetSourceOccurrenceOffsetInput = {
    sourceStartBeat: number;
    segmentStartBeat: number;
    loopLength: number;
    loopEnabled: boolean;
};

export type ScheduledIterationRange = {
    endIndex: number;
    startIndex: number;
};
export type GetScheduledIterationRangeInput = {
    clipStartBeat: number;
    fromBeat: number;
    iterationCount: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    toBeat: number;
};

export const MAX_GROOVE_STAGE_DISPLACEMENT_BEATS = 0.25;
export function getScheduledIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    toBeat,
}: GetScheduledIterationRangeInput): ScheduledIterationRange {
    if (!loopEnabled) {
        return { startIndex: 0, endIndex: Math.min(1, iterationCount) };
    }
    const startIndex = Math.max(0, Math.floor((fromBeat - clipStartBeat) / loopLengthBeats));
    const endIndex = Math.min(iterationCount, Math.ceil((toBeat - clipStartBeat) / loopLengthBeats));
    return { startIndex: Math.min(startIndex, endIndex), endIndex };
}

export function getSourceOccurrenceOffset({
    sourceStartBeat,
    segmentStartBeat,
    loopLength,
    loopEnabled,
}: GetSourceOccurrenceOffsetInput): number {
    if (!loopEnabled || loopLength <= 0) {
        return 0;
    }

    const beatsFromSourceStart = segmentStartBeat - sourceStartBeat;
    if (beatsFromSourceStart <= 0) {
        return 0;
    }

    // Mirrors the offline module's tolerant floor (#5198): an advance within the
    // beat tolerance of an exact multiple of the loop length is that many loops
    // — the raw quotient mis-floors by one ulp at non-dyadic loop lengths.
    const quotient = beatsFromSourceStart / loopLength;
    const nearestMultiple = loopLength * Math.round(quotient);
    if (Math.abs(beatsFromSourceStart - nearestMultiple) <= CLIP_LOOP_WINDOW_BEAT_TOLERANCE) {
        return Math.round(quotient);
    }
    return Math.floor(quotient);
}
