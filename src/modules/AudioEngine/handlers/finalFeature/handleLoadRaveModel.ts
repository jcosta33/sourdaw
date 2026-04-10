import { createHandler } from '#/helpers/createHandler';
import { loadModel } from '../../useCases/rave/loadModel';

export const handleLoadRaveModel = createHandler<'loadRaveModel'>({
    execute: (a) => {
        loadModel(a.payload.modelId);
    },
    describe: () => ({ label: 'Load RAVE Model' }),
    undoable: false,
});
