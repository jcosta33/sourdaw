import { runLegacyCommandMutationUnderOwner } from '#/modules/Command/useCases';
import { addManualMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticAddMarker = createHandler<'elasticAddMarker'>({
    execute: (a) => {
        addManualMarker(a.payload.clipId, a.payload.localBeat, runLegacyCommandMutationUnderOwner);
    },
    describe: () => ({ label: 'Add Elastic Marker' }),
    undoable: false,
});
