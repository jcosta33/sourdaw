import { updateClip, getTrackState } from '#/modules/Arrangement/repositories/track';
import { type StretchMode } from '#/modules/Arrangement/models/Track';

const MIN_RATIO = 0.25;
const MAX_RATIO = 4.0;

function clampRatio(ratio: number): number {
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export function setClipStretchMode(clipId: string, mode: StretchMode): void {
    updateClip(clipId, (c) => ({ ...c, stretchMode: mode }));
}

export function setClipStretchRatio(clipId: string, ratio: number): void {
    const clamped = clampRatio(ratio);

    updateClip(clipId, (c) => {
        const updated = { ...c, stretchRatio: clamped };

        if (c.stretchMode === 'repitch') {
            const originalDuration = c.endBeat - c.startBeat;
            const previousRatio = c.stretchRatio ?? 1;
            const baseDuration = originalDuration * previousRatio;
            updated.endBeat = c.startBeat + baseDuration / clamped;
        }

        return updated;
    });
}

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
