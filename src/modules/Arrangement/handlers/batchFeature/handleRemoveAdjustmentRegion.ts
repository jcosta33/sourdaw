import { createHandler } from '#/utils/createHandler';

import { removeAdjustmentRegion } from '../../useCases/adjustmentLayer/removeAdjustmentRegion';

export const handleRemoveAdjustmentRegion = createHandler<'removeAdjustmentRegion'>({
    execute: (a) => {
        removeAdjustmentRegion(a.payload.layerId, a.payload.regionId);
    },
    describe: () => ({ label: 'Remove Adjustment Region' }),
    undoable: true,
});
