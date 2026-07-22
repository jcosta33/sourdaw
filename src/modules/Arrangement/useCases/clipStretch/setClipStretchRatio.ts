import { updateClip } from '../../repositories/track/updateClip';

import { clampRatio } from './helpers';

export function setClipStretchRatio(clipId: string, ratio: number): boolean {
    if (!Number.isFinite(ratio)) {
        return false;
    }

    const clamped = clampRatio(ratio);

    return updateClip(clipId, (context) => {
        const updated = { ...context, stretchRatio: clamped };

        if (context.stretchMode === 'repitch') {
            const originalDuration = context.endBeat - context.startBeat;
            const previousRatio = context.stretchRatio ?? 1;
            const baseDuration = originalDuration * previousRatio;
            updated.endBeat = context.startBeat + baseDuration / clamped;
        }

        return updated;
    });
}
