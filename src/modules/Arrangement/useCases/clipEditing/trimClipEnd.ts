import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

import { planEndTrim } from './planEndTrim';

export function trimClipEnd(clipId: string, newEndBeat: number): boolean {
    if (!Number.isFinite(newEndBeat)) {
        return false;
    }

    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target && !planEndTrim(target.clip, newEndBeat)) {
                return false;
            }
        }
    } catch {
        return false;
    }

    return updateClip(clipId, (context) => planEndTrim(context, newEndBeat) ?? context);
}
