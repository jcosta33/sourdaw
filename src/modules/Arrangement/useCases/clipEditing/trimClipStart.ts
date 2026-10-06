import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

/**
 * A looped clip reads its notes at `note.startBeat - midiOffsetBeats` wrapped by
 * the loop length, so scheduling only sees the offset's phase inside
 * `[0, loopLength)` — but the piano roll, splitting, and glue all read the raw
 * figure. Wrap the trim's advance into that range so every consumer stays
 * inside the loop the clip plays.
 */
function loopedMidiOffsetBeats(clip: Clip, offset: number): number {
    const loopEnabled = clip.loopEnabled ?? false;
    if (!loopEnabled) {
        return offset;
    }
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });
    return ((offset % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
}

export function trimClipStart(clipId: string, newStartBeat: number): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }

    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target && newStartBeat >= target.clip.endBeat) {
                return false;
            }
        }
    } catch {
        return false;
    }

    return updateClip(clipId, (context) => {
        if (newStartBeat < context.endBeat) {
            const startBeat = Math.max(0, newStartBeat);
            const delta = startBeat - context.startBeat;
            const updated = {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
            };
            if (context.type === 'midi') {
                return {
                    ...updated,
                    midiOffsetBeats: loopedMidiOffsetBeats(updated, (context.midiOffsetBeats ?? 0) + delta),
                };
            }
            return updated;
        }
        return context;
    });
}
