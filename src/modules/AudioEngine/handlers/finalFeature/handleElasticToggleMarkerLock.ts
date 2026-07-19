import { runLegacyCommandMutationUnderOwner } from '#/modules/Command/useCases';
import { toggleMarkerLock } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticToggleMarkerLock = createHandler<'elasticToggleMarkerLock'>({
    execute: (a) => {
        toggleMarkerLock(a.payload.markerId, runLegacyCommandMutationUnderOwner);
    },
    describe: () => ({ label: 'Toggle Elastic Marker Lock' }),
    undoable: false,
});
