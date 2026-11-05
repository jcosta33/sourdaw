import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

/** The arrangement placement fields that decide which stored notes play. */
export type ClipPlacement = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    configuredLoopLengthBeats?: number;
    loopOriginBeat?: number;
};

type AudibleNoteWindow = {
    /** Start of the span playback renders, in stored (clip-relative) note beats. */
    startBeat: number;
    /** End of that span; nothing at or past it sounds. */
    endBeat: number;
    /** Span of one pass: the clip's visual length, or the loop length while looping. */
    windowLengthBeats: number;
};

/**
 * The span of stored-note time one pass of a clip renders: from the clip's
 * MIDI offset, carried back by a loop anchor's trim advance, for the clip's
 * length or its loop length while looping. Playback cuts every note to the
 * pass, so a note crossing the end sounds only up to it and a note starting at
 * or past the end is silent. Below the start the anchor decides
 * (`isBeatInClipLoopWindow`): without one, a note starting earlier still sounds
 * from the start on; with one, a note starting below it is dropped whole.
 *
 * Returns `undefined` for a clip without a finite positive length (an unplaced
 * clip), which has no window to draw or convert against.
 */
export function resolveAudibleNoteWindow(placement: ClipPlacement): AudibleNoteWindow | undefined {
    const clipDurationBeats = placement.endBeat - placement.startBeat;
    if (!Number.isFinite(clipDurationBeats) || clipDurationBeats <= 0) {
        return undefined;
    }
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats,
        configuredLoopLengthBeats: placement.configuredLoopLengthBeats,
        loopEnabled: placement.loopEnabled,
    });
    const advanceBeats = resolveClipLoopOriginAdvance({
        startBeat: placement.startBeat,
        loopOriginBeat: placement.loopOriginBeat,
        loopEnabled: placement.loopEnabled,
    });
    const startBeat = placement.midiOffsetBeats - advanceBeats;
    return { startBeat, endBeat: startBeat + loopLengthBeats, windowLengthBeats: loopLengthBeats };
}
