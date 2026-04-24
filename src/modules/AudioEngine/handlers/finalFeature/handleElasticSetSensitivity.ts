import { createHandler } from '#/utils/createHandler';

import { setElasticSensitivity } from '../../useCases/elasticAudio/setElasticSensitivity';

export const handleElasticSetSensitivity = createHandler<'elasticSetSensitivity'>({
    execute: async (a) => {
        await setElasticSensitivity(a.payload.sensitivity);
    },
    describe: () => ({ label: 'Set Elastic Sensitivity' }),
    undoable: false,
});
