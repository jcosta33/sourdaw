import { toggleMarkerLock } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticToggleMarkerLock = createHandler<'elasticToggleMarkerLock'>({
    execute: (a) => {
        toggleMarkerLock(a.payload.markerId);
    },
    describe: () => ({ label: 'Toggle Elastic Marker Lock' }),
    undoable: false,
});
