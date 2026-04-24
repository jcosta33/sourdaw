import { createHandler } from '#/utils/createHandler';

import { toggleAdjustmentLayer } from '../../useCases/adjustmentLayer/toggleAdjustmentLayer';

export const handleToggleAdjustmentLayer = createHandler<'toggleAdjustmentLayer'>({
    execute: (a) => {
        toggleAdjustmentLayer(a.payload.layerId);
    },
    describe: () => ({ label: 'Toggle Adjustment Layer' }),
    undoable: true,
});
