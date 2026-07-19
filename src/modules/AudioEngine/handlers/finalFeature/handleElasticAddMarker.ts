import { addManualMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticAddMarker = createHandler<'elasticAddMarker'>({
    execute: (a, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to add an Elastic marker');
        }
        addManualMarker(a.payload.clipId, a.payload.localBeat, context.runLegacyCommandMutation);
    },
    describe: () => ({ label: 'Add Elastic Marker' }),
    undoable: false,
});
