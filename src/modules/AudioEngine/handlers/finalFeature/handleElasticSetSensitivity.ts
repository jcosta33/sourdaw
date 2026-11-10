import { setElasticSensitivity } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticSetSensitivity = createHandler<'elasticSetSensitivity'>({
    execute: async (a, context) => {
        await setElasticSensitivity(a.payload.sensitivity, context?.signal);
    },
    describe: () => ({ label: 'Set Elastic Sensitivity' }),
    executionKind: 'runtime',
    undoable: false,
});
