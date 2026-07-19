import { toggleMarkerLock } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticToggleMarkerLock = createHandler<'elasticToggleMarkerLock'>({
    execute: (a, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to toggle an Elastic marker lock');
        }
        toggleMarkerLock(a.payload.markerId, context.runLegacyCommandMutation);
    },
    describe: () => ({ label: 'Toggle Elastic Marker Lock' }),
    undoable: false,
});
