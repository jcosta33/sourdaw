import { createHandler } from '#/utils/createHandler';

import { toggleMarkerLock } from '../../useCases/elasticAudio/toggleMarkerLock';

export const handleElasticToggleMarkerLock = createHandler<'elasticToggleMarkerLock'>({
    execute: (a) => {
        toggleMarkerLock(a.payload.markerId);
    },
    describe: () => ({ label: 'Toggle Elastic Marker Lock' }),
    undoable: false,
});
