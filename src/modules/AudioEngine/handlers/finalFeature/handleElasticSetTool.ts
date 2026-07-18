import { setElasticTool } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticSetTool = createHandler<'elasticSetTool'>({
    execute: (a) => {
        setElasticTool(a.payload.tool);
    },
    describe: () => ({ label: 'Set Elastic Tool' }),
    undoable: false,
});
