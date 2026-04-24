import { createHandler } from '#/utils/createHandler';

import { loadModel } from '../../useCases/rave/loadModel';

export const handleLoadRaveModel = createHandler<'loadRaveModel'>({
    execute: (alpha) => {
        loadModel(alpha.payload.modelId);
    },
    describe: () => ({ label: 'Load RAVE Model' }),
    undoable: false,
});
