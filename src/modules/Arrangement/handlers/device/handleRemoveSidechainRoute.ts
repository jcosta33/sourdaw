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
    describe: () => ({ label: 'Remove sidechain route' }),
    undoable: true,
});
