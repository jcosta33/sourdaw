import { createHandler } from '#/utils/createHandler';

import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat));
    },
    describe: (alpha) => {
        const label = 'Trim clip end';
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
                inverseAction: { type: 'trimClipEnd', payload: { clipId: clip.id, newEndBeat: clip.endBeat } },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
