import { createHandler } from '#/helpers/createHandler';
import { addSidechainRoute } from '#/modules/Routing/useCases';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleAddSidechainRoute = createHandler<'addSidechainRoute'>({
    execute: (a) => {
        const targetTrack = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.targetTrackId);
        const scDevice = targetTrack?.devices.find((d) => d.type.toLowerCase().includes('sidechain'));
        if (scDevice) {
            addSidechainRoute(a.payload.sourceTrackId, a.payload.targetTrackId, scDevice.id);
        }
    },
    describe: () => ({ label: 'Add sidechain route' }),
    undoable: true,
});
