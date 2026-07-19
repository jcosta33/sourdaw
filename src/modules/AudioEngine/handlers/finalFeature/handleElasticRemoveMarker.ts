import { runLegacyCommandMutationUnderOwner } from '#/modules/Command/useCases';
import { removeMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticRemoveMarker = createHandler<'elasticRemoveMarker'>({
    execute: (a) => {
        removeMarker(a.payload.markerId, runLegacyCommandMutationUnderOwner);
    },
    describe: () => ({ label: 'Remove Elastic Marker' }),
    undoable: false,
});
