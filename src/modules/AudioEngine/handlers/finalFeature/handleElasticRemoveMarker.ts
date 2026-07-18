import { removeMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticRemoveMarker = createHandler<'elasticRemoveMarker'>({
    execute: (a) => {
        removeMarker(a.payload.markerId);
    },
    describe: () => ({ label: 'Remove Elastic Marker' }),
    undoable: false,
});
