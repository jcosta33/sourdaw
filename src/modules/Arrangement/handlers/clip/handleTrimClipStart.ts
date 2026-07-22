import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        return {
            label: 'Trim clip start',
            inverseAction: clip
                ? { type: 'trimClipStart', payload: { clipId: clip.id, newStartBeat: clip.startBeat } }
                : null,
        };
    },
    undoable: true,
});
