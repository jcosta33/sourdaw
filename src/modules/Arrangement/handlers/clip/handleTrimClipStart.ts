import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { planTrimmedTakeStarts } from '../../useCases/comping/planTrimmedTakeStarts';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type TrimmedClip = { id: string; startBeat: number; endBeat: number };

function plannedTakeStarts(clip: TrimmedClip, newStartBeat: number) {
    if (!Number.isFinite(newStartBeat) || newStartBeat >= clip.endBeat) {
        return [];
    }
    return planTrimmedTakeStarts({
        clipId: clip.id,
        previousStartBeat: clip.startBeat,
        newStartBeat: Math.max(0, newStartBeat),
    }).before;
}

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat));
    },
    describe: (alpha) => {
        const label = 'Trim clip start';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            const takes = plannedTakeStarts(clip, alpha.payload.newStartBeat);
            if (takes.length > 0) {
                return {
                    label,
                    inverseAction: {
                        type: 'restoreClipStartTrim',
                        payload: { clipId: clip.id, newStartBeat: clip.startBeat, takes },
                    },
                };
            }

            return {
                label,
                inverseAction: { type: 'trimClipStart', payload: { clipId: clip.id, newStartBeat: clip.startBeat } },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
