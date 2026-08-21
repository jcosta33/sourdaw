import { createHandler } from '#/utils/createHandler';

import { setLayerParameter } from '../../useCases/adjustmentLayer/setLayerParameter';

export const handleSetLayerParameter = createHandler<'setLayerParameter'>({
    execute: (a) => {
        setLayerParameter(a.payload.layerId, a.payload.paramName, a.payload.value);
    },
    describe: () => ({ label: 'Set Layer Parameter' }),
    undoable: false,
});
