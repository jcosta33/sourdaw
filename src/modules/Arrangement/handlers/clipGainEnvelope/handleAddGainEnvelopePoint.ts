import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getEnvelope } from '../../stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from '../../useCases/clipGainEnvelope/addGainEnvelopePoint';

type AddGainEnvelopePointAction = Extract<AppAction, { type: 'addGainEnvelopePoint' }>;

// Mirror of handleAddMarker's ensureMarkerId: the inverse needs the new
// point's id before execute runs, so describe mints it onto the payload and
// execute reuses it (describe always runs before execute).
function ensurePointId(action: AddGainEnvelopePointAction): string {
    if (action.payload.pointId) {
        return action.payload.pointId;
    }
    const pointId = `gep-${crypto.randomUUID().slice(0, 6)}`;
    action.payload.pointId = pointId;
    return pointId;
}

export const handleAddGainEnvelopePoint = createHandler<'addGainEnvelopePoint'>({
    execute: (action) => {
        addGainEnvelopePoint(
            action.payload.clipId,
            action.payload.beatOffset,
            action.payload.gainDb,
            ensurePointId(action)
        );
        return undefined;
    },
    describe: (action) => {
        const pointId = ensurePointId(action);
        const prev = getEnvelope(action.payload.clipId);
        // A point-level removal is the faithful inverse only when the prior
        // envelope survives the removal as itself: with no prior envelope the
        // add created one, and an empty prior points array means the removal
        // would fire the "never zero points" substitution — both need the
        // whole-envelope restore instead.
        if (prev === undefined || prev.points.length === 0) {
            return {
                label: 'Add gain envelope breakpoint',
                inverseAction: {
                    type: 'setClipGainEnvelope',
                    payload: { clipId: action.payload.clipId, envelope: prev ?? null },
                },
            };
        }
        return {
            label: 'Add gain envelope breakpoint',
            inverseAction: { type: 'removeGainEnvelopePoint', payload: { clipId: action.payload.clipId, pointId } },
        };
    },
    undoable: true,
});
