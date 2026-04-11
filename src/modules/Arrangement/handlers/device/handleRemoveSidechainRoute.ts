import { createHandler } from '#/helpers/createHandler';
import { getSidechainRoutesForTrack, removeSidechainRoute } from '#/modules/Routing/useCases';

export const handleRemoveSidechainRoute = createHandler<'removeSidechainRoute'>({
    execute: (a) => {
        const routes = getSidechainRoutesForTrack(a.payload.targetTrackId);
        const route = routes.find((r) => r.sourceTrackId === a.payload.sourceTrackId);
        if (route) {
            removeSidechainRoute(route.id);
        }
    },
    describe: () => ({ label: 'Remove sidechain route' }),
    undoable: true,
});
