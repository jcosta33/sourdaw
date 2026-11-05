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
    /** First stored note start (clip-relative beats) that plays. */
    startBeat: number;
    /** First stored note start past the window; a note starting here is silent. */
    endBeat: number;
    /** Span of one pass: the clip's visual length, or the loop length while looping. */
    windowLengthBeats: number;
};

/**
 * The span of stored note starts that playback admits for a clip. Scheduling
 * admits a note by its start alone (`isBeatInClipLoopWindow`, on
 * `note.startBeat - midiOffsetBeats`): a note starting inside the window plays
 * to its full length even past the end, a note starting at or past the end is
 * silent. A loop anchor carries the floor back by the trim advance.
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
