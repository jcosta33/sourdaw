import { addSidechainRoute } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleAddSidechainRoute = createHandler<'addSidechainRoute'>({
    execute: (alpha) => {
        const targetTrack = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.targetTrackId);
        const scDevice = targetTrack?.devices.find((data) => data.type.toLowerCase().includes('sidechain'));
        if (scDevice) {
            addSidechainRoute(alpha.payload.sourceTrackId, alpha.payload.targetTrackId, scDevice.id);
        }
    },
    describe: () => ({ label: 'Add sidechain route' }),
    undoable: true,
});
