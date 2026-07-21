import { addSidechainRoute } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleAddSidechainRoute = createHandler<'addSidechainRoute'>({
    execute: (alpha) => {
        const targetTrack = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.targetTrackId);
        const scDevice = targetTrack?.devices.find((data) => data.type.toLowerCase().includes('sidechain'));
        if (!scDevice) {
            return toHandlerExecutionResult(false);
        }
        const didWrite = addSidechainRoute(alpha.payload.sourceTrackId, alpha.payload.targetTrackId, scDevice.id);
        return toHandlerExecutionResult(didWrite);
    },
    // Undo must re-derive engine wiring, not lean on a CRDT store revert: replaying the
    // inverse `removeSidechainRoute` runs the use case that both unwires the engine route
    // and drops it from the store, keeping audio graph and store in lockstep. Without an
    // inverse the undo is an inert no-op — the route stays wired and in the post-add store.
    describe: (alpha) => ({
        label: 'Add sidechain route',
        inverseAction: {
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: alpha.payload.sourceTrackId, targetTrackId: alpha.payload.targetTrackId },
        },
    }),
    undoable: true,
});
