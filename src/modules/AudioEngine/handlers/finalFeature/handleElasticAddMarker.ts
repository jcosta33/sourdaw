import { createHandler } from '#/utils/createHandler';

import { addManualMarker } from '../../useCases/elasticAudio/addManualMarker';

export const handleElasticAddMarker = createHandler<'elasticAddMarker'>({
    execute: (a) => {
        addManualMarker(a.payload.clipId, a.payload.localBeat);
    },
    describe: () => ({ label: 'Add Elastic Marker' }),
    undoable: false,
});
