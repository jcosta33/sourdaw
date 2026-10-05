import { createHandler } from '#/utils/createHandler';

import { getEnvelope } from '../../stores/gainEnvelopeStore';
import { resetClipGainEnvelope } from '../../useCases/clipGainEnvelope/resetClipGainEnvelope';

export const handleResetClipGainEnvelope = createHandler<'resetClipGainEnvelope'>({
    execute: (action) => {
        resetClipGainEnvelope(action.payload.clipId);
        return undefined;
    },
    describe: (action) => {
        const prev = getEnvelope(action.payload.clipId);
        return {
            label: `Reset the gain envelope of clip ${action.payload.clipId}`,
            // The reset replaces points and enabled wholesale; restoring the
            // prior envelope (or removing the created one when the clip had
            // none) is the only exact inverse.
            inverseAction: {
                type: 'setClipGainEnvelope',
                payload: { clipId: action.payload.clipId, envelope: prev ?? null },
            },
        };
    },
    undoable: true,
});
