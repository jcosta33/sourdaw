import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

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
