import { createHandler } from '#/utils/createHandler';

import { removeMarker } from '../../useCases/elasticAudio/removeMarker';

export const handleElasticRemoveMarker = createHandler<'elasticRemoveMarker'>({
    execute: (a) => {
        removeMarker(a.payload.markerId);
    },
    describe: () => ({ label: 'Remove Elastic Marker' }),
    undoable: false,
});
