import { removeMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticRemoveMarker = createHandler<'elasticRemoveMarker'>({
    execute: (a, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to remove an Elastic marker');
        }
        removeMarker(a.payload.markerId, context.runLegacyCommandMutation);
    },
    describe: () => ({ label: 'Remove Elastic Marker' }),
    undoable: false,
});
