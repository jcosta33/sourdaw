import { setElasticSensitivity } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticSetSensitivity = createHandler<'elasticSetSensitivity'>({
    execute: async (a) => {
        await setElasticSensitivity(a.payload.sensitivity);
    },
    describe: () => ({ label: 'Set Elastic Sensitivity' }),
    undoable: false,
});
