/**
 * The loop anchor a start trim must not move (#4988).
 *
 * A looped clip's content offset answers "where does the clip's head enter its
 * material", and a start trim advances it — that is the trim working. What the
 * trim must not do is move the loop region and the per-pass occurrence count
 * with it: per the convention trimming shows a different portion of the same
 * loop. `Clip.loopOriginBeat` carries the timeline beat the loop was
 * established at (loop enable, or the first trim of a clip born looped), and
 * every loop-window reader derives the trim's advance from it:
 *
 *     advanceBeats = clip.startBeat - (clip.loopOriginBeat ?? clip.startBeat)
 *
 * An absent field derives an advance of zero, which reproduces the
 * pre-anchor behavior exactly — legacy projects read as they always did.
 */

export type ClipLoopOriginInput = Readonly<{
    startBeat: number;
    loopOriginBeat: number | undefined;
}>;

/** How far start trims have advanced this clip's head past its loop anchor. */
export function resolveClipLoopOriginAdvance({ startBeat, loopOriginBeat }: ClipLoopOriginInput): number {
    return startBeat - (loopOriginBeat ?? startBeat);
}

type ClipLoopWindowMembershipInput = Readonly<{
    /**
     * The candidate's position in the coordinate the loop window reads — for a
     * MIDI note, `note.startBeat - midiOffsetBeats`.
     */
    relativeBeat: number;
    startBeat: number;
    loopOriginBeat: number | undefined;
    loopLengthBeats: number;
}>;

/**
 * Whether a candidate sits inside a looped clip's loop window.
 *
 * The pre-anchor law admitted everything below the loop length — a one-sided
 * bound whose ceiling slid right with every trim, admitting material the loop
 * never covered. The anchored law is the half-open region the clip was looped
 * with, carried backwards by the trim advance in the offset-relative
 * coordinate: `[−advance, loopLength − advance)`. Notes at or past the region
 * end stay out of every pass however far the clip is trimmed.
 */
export function isBeatInClipLoopWindow({
    relativeBeat,
    startBeat,
    loopOriginBeat,
    loopLengthBeats,
}: ClipLoopWindowMembershipInput): boolean {
    if (loopOriginBeat === undefined) {
        return relativeBeat < loopLengthBeats;
    }
    const windowFloorBeat = -resolveClipLoopOriginAdvance({ startBeat, loopOriginBeat });
    return relativeBeat >= windowFloorBeat && relativeBeat < windowFloorBeat + loopLengthBeats;
}
