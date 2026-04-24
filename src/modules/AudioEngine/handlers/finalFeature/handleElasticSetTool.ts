import { createHandler } from '#/utils/createHandler';

import { setElasticTool } from '../../useCases/elasticAudio/setElasticTool';

export const handleElasticSetTool = createHandler<'elasticSetTool'>({
    execute: (a) => {
        setElasticTool(a.payload.tool);
    },
    describe: () => ({ label: 'Set Elastic Tool' }),
    undoable: false,
});
