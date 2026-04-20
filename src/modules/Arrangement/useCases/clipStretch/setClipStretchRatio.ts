import { updateClip } from '../../repositories/track/updateClip';

import { clampRatio } from './helpers';

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
