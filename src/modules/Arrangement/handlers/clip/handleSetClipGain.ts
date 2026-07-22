import { createHandler } from '#/utils/createHandler';

import { setClipGain } from '../../useCases/clipEditing/setClipGain';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipGain = createHandler<'setClipGain'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setClipGain(alpha.payload.clipId, alpha.payload.gain));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        return {
            label: 'Set clip gain',
            inverseAction: clip ? { type: 'setClipGain', payload: { clipId: clip.id, gain: clip.gain } } : null,
        };
    },
    undoable: true,
});
