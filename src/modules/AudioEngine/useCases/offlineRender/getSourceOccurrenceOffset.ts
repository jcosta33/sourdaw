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

    return Math.floor(beatsFromSourceStart / loopLength);
}
