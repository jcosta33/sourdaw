import { getSidechainRoutesForTrack, removeSidechainRoute } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveSidechainRoute = createHandler<'removeSidechainRoute'>({
    execute: (alpha) => {
        const routes = getSidechainRoutesForTrack(alpha.payload.targetTrackId);
        const route = routes.find((r) => r.sourceTrackId === alpha.payload.sourceTrackId);
        if (route) {
            removeSidechainRoute(route.id);
        }
    },
    // Undo must re-derive engine wiring, not lean on a CRDT store revert: replaying the
    // inverse `addSidechainRoute` runs the use case that re-wires the engine route and
    // re-adds it to the store, keeping audio graph and store in lockstep. Without an
    // inverse the undo is an inert no-op — the route stays unwired and absent from the store.
    describe: (alpha) => ({
        label: 'Remove sidechain route',
        inverseAction: {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: alpha.payload.sourceTrackId, targetTrackId: alpha.payload.targetTrackId },
        },
    }),
    undoable: true,
});
