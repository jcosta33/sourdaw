import { createHandler } from '#/utils/createHandler';

import { removeAdjustmentLayer } from '../../useCases/adjustmentLayer/removeAdjustmentLayer';

export const handleRemoveAdjustmentLayer = createHandler<'removeAdjustmentLayer'>({
    execute: (a) => {
        removeAdjustmentLayer(a.payload.layerId);
    },
    describe: () => ({ label: 'Remove Adjustment Layer' }),
    undoable: false,
});
