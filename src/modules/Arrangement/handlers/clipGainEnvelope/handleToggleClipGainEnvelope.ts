import { createHandler } from '#/utils/createHandler';

import { getEnvelope } from '../../stores/gainEnvelopeStore';
import { toggleClipGainEnvelope } from '../../useCases/clipGainEnvelope/toggleClipGainEnvelope';

export const handleToggleClipGainEnvelope = createHandler<'toggleClipGainEnvelope'>({
    execute: (action) => {
        // `expectedEnabled` is the pre-toggle value the surface read: when the
        // live envelope no longer matches it the flip would land on the wrong
        // side, so it reports the conflict instead of toggling blind.
        const current = getEnvelope(action.payload.clipId);
        if (action.payload.expectedEnabled !== undefined && current?.enabled !== action.payload.expectedEnabled) {
            return { status: 'conflict' };
        }
        toggleClipGainEnvelope(action.payload.clipId);
        return undefined;
    },
    describe: (action) => {
        const prev = getEnvelope(action.payload.clipId);
        if (prev === undefined) {
            // The toggle created the envelope (use-case ensure); undo removes it.
            return {
                label: `Toggle the gain envelope of clip ${action.payload.clipId}`,
                inverseAction: {
                    type: 'setClipGainEnvelope',
                    payload: { clipId: action.payload.clipId, envelope: null },
                },
            };
        }
        return {
            label: `Toggle the gain envelope of clip ${action.payload.clipId}`,
            // The inverse flips back, guarded on the state the forward left so
            // a diverged replay conflicts rather than mis-flips.
            inverseAction: {
                type: 'toggleClipGainEnvelope',
                payload: { clipId: action.payload.clipId, expectedEnabled: !prev.enabled },
            },
        };
    },
    undoable: true,
});
