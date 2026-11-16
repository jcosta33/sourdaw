import { trackStore } from '#/modules/Arrangement/stores';
import { captureGestureBeat } from '#/modules/Transport/stores';

import { type ClipPlacement, resolveAudibleNoteWindow } from './audibleNoteWindow';

/**
 * Read a clip's arrangement placement from the arrangement store. Clips opened
 * alongside the primary one may live on any track, so every track is searched.
 * An absent MIDI offset or loop flag reads as none.
 */
function resolveClipPlacement(clipId: string): ClipPlacement | undefined {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return {
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                loopEnabled: clip.loopEnabled ?? false,
                configuredLoopLengthBeats: clip.loopLength,
                loopOriginBeat: clip.loopOriginBeat,
            };
        }
    }
    return undefined;
}

/**
 * Convert an arrangement playhead beat into the clip-relative beat the MIDI
 * note transforms expect — MIDI note starts are stored clip-relative, not as
 * arrangement beats. Scheduling projects a stored note into the arrangement as
 * `iterationStartBeat + (startBeat - midiOffsetBeats)` with
 * `iterationStartBeat = clip.startBeat + iteration * loopLengthBeats`
 * (`projectClipMidiEvents`); this is that projection's inverse: the playhead's
 * offset into the loop iteration it falls in, restored to media coordinates by
 * adding the clip's MIDI offset.
 *
 * Returns `undefined` when the playhead sits outside the clip's visible span —
 * a cursor that is not over the clip must not split anything.
 */
function arrangementPlayheadToClipBeat(playheadBeat: number, placement: ClipPlacement): number | undefined {
    if (playheadBeat < placement.startBeat || playheadBeat >= placement.endBeat) {
        return undefined;
    }
    const intoClip = playheadBeat - placement.startBeat;
    const windowLengthBeats = resolveAudibleNoteWindow(placement)?.windowLengthBeats;
    if (placement.loopEnabled && windowLengthBeats !== undefined) {
        return (intoClip % windowLengthBeats) + placement.midiOffsetBeats;
    }
    return intoClip + placement.midiOffsetBeats;
}

/**
 * The clip-relative beat under the transport playhead, or `undefined` when the
 * clip is not in the arrangement or the playhead is outside it. Controller and
 * pitch-bend rows share the note coordinates, so keyboard insertion in their
 * lanes reads the same position the piano roll splits at.
 *
 * The beat is the key press's own, stamped by the gesture clock
 * (`captureGestureBeat`), so callers must read it on the key handler's
 * synchronous path.
 */
export function readClipPlayheadBeat(clipId: string): number | undefined {
    const gestureBeat = captureGestureBeat();
    const placement = resolveClipPlacement(clipId);
    if (placement === undefined) {
        return undefined;
    }
    return arrangementPlayheadToClipBeat(gestureBeat, placement);
}
