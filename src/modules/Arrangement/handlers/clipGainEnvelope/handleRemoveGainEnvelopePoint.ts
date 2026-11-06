import { createHandler } from '#/utils/createHandler';

import { getEnvelope } from '../../stores/gainEnvelopeStore';
import { removeGainEnvelopePoint } from '../../useCases/clipGainEnvelope/removeGainEnvelopePoint';
import { isMidiClip } from '../isMidiClip';

export const handleRemoveGainEnvelopePoint = createHandler<'removeGainEnvelopePoint'>({
    execute: (action) => {
        if (isMidiClip(action.payload.clipId)) {
            return { status: 'no-write' };
        }
        removeGainEnvelopePoint(action.payload.clipId, action.payload.pointId);
        return undefined;
    },
    describe: (action) => {
        const prev = getEnvelope(action.payload.clipId);
        if (prev === undefined || !prev.points.some((point) => point.id === action.payload.pointId)) {
            return { label: 'Remove gain envelope breakpoint' };
        }
        // The removal's "never zero points" rule substitutes a fresh default
        // when the last point goes away, so a re-add inverse would leave that
        // default behind. Restoring the whole prior envelope is exact in every
        // case, including that one.
        return {
            label: 'Remove gain envelope breakpoint',
            inverseAction: { type: 'setClipGainEnvelope', payload: { clipId: prev.clipId, envelope: prev } },
        };
    },
    undoable: true,
});
