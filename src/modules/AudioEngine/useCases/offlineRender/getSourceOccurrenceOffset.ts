/**
 * Which occurrence of a looping clip's source a segment starts on.
 *
 * A comped or split segment begins partway into the source it was cut from, and
 * the probability roll is seeded with the occurrence index rather than the
 * iteration index — so a note kept on the third pass of a loop stays kept when
 * the musician trims the clip in front of it. This offset is what carries the
 * source's own count across that cut.
 *
 * Extracted from `scheduleTrackClips` so the live native MIDI producer rolls
 * the same chance for the same note (#3892): a second copy of this arithmetic
 * is exactly how the browser and the engine start voicing different takes of
 * one arrangement.
 */

import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

export type SourceOccurrenceOffsetInput = Readonly<{
    sourceStartBeat: number;
    segmentStartBeat: number;
    loopLength: number;
    loopEnabled: boolean;
}>;

export function getSourceOccurrenceOffset({
    sourceStartBeat,
    segmentStartBeat,
    loopLength,
    loopEnabled,
}: SourceOccurrenceOffsetInput): number {
    if (!loopEnabled || loopLength <= 0) {
        return 0;
    }

    const beatsFromSourceStart = segmentStartBeat - sourceStartBeat;
    if (beatsFromSourceStart <= 0) {
        return 0;
    }

    // An advance that is an exact whole number of loops must count that many
    // occurrences, but a non-dyadic loop length leaves the correctly-rounded
    // quotient one ulp below the integer (loop 1.1 trimmed by 16.5 — exactly
    // 15 loops — computes 14.999999999999998) and a raw floor drops the
    // occurrence: the first post-trim pass re-rolls a pass that had already
    // sounded. Predicate: when the advance sits within
    // `CLIP_LOOP_WINDOW_BEAT_TOLERANCE` of the nearest exact multiple
    // `loopLength * Math.round(quotient)`, the advance *is* that many loops
    // and the index is `Math.round(quotient)`; only a genuinely sub-floor
    // advance floors the raw quotient. Same one-ulp class the loop window
    // absorbs in `isBeatInClipLoopWindow` (#5198).
    const quotient = beatsFromSourceStart / loopLength;
    const nearestMultiple = loopLength * Math.round(quotient);
    if (Math.abs(beatsFromSourceStart - nearestMultiple) <= CLIP_LOOP_WINDOW_BEAT_TOLERANCE) {
        return Math.round(quotient);
    }
    return Math.floor(quotient);
}
