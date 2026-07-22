import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

export function trimClipEnd(clipId: string, newEndBeat: number): boolean {
    if (!Number.isFinite(newEndBeat)) {
        return false;
    }

    const state = getTrackState();
    if (state) {
        const target = findClipById({ clipId, tracks: state.tracks });
        if (target && newEndBeat <= target.clip.startBeat) {
            return false;
        }
    }

    return updateClip(clipId, (context) => {
        if (newEndBeat <= context.startBeat) {
            return context;
        }

        return { ...context, endBeat: newEndBeat };
    });
}
