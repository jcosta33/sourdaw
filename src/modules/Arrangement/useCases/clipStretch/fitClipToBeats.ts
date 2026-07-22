import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';

import { clampRatio } from './helpers';

export function fitClipToBeats(clipId: string, targetBeats: number): boolean {
    if (!Number.isFinite(targetBeats)) {
        return false;
    }

    if (targetBeats <= 0) {
        return false;
    }

    let newRatio: number | null = null;
    try {
        const state = getTrackState();
        if (!state) {
            return false;
        }

        for (const track of state.tracks) {
            const clip = track.clips.find((context) => context.id === clipId);
            if (!clip) {
                continue;
            }

            const currentDuration = clip.endBeat - clip.startBeat;
            const previousRatio = clip.stretchRatio ?? 1;
            const baseDuration = currentDuration * previousRatio;
            newRatio = clampRatio(baseDuration / targetBeats);
            break;
        }
    } catch {
        return false;
    }

    if (newRatio === null) {
        return false;
    }

    return updateClip(clipId, (context) => ({
        ...context,
        stretchRatio: newRatio,
        stretchMode: context.stretchMode === 'off' ? ('repitch' as const) : context.stretchMode,
        endBeat: context.startBeat + targetBeats,
    }));
}
