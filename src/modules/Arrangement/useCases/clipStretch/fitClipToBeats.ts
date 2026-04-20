import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';

import { clampRatio } from './helpers';

export function fitClipToBeats(clipId: string, targetBeats: number): void {
    if (targetBeats <= 0) {
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip) {
            continue;
        }

        const currentDuration = clip.endBeat - clip.startBeat;
        const previousRatio = clip.stretchRatio ?? 1;
        const baseDuration = currentDuration * previousRatio;
        const newRatio = clampRatio(baseDuration / targetBeats);

        updateClip(clipId, (c) => ({
            ...c,
            stretchRatio: newRatio,
            stretchMode: c.stretchMode === 'off' ? ('repitch' as const) : c.stretchMode,
            endBeat: c.startBeat + targetBeats,
        }));
        return;
    }
}
