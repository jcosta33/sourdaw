import { addManualMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticAddMarker = createHandler<'elasticAddMarker'>({
    execute: (a) => {
        addManualMarker(a.payload.clipId, a.payload.localBeat);
    },
    describe: () => ({ label: 'Add Elastic Marker' }),
    undoable: false,
});
