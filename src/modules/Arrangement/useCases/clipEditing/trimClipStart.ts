import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

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
            return {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
            };
        }
        return context;
    });
}
