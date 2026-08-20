import { createHandler } from '#/utils/createHandler';

import { toggleAdjustmentLayer } from '../../useCases/adjustmentLayer/toggleAdjustmentLayer';

export const handleToggleAdjustmentLayer = createHandler<'toggleAdjustmentLayer'>({
    execute: (a) => {
        toggleAdjustmentLayer(a.payload.layerId);
    },
    describe: (a) => ({
        label: 'Toggle Adjustment Layer',
        inverseAction: {
            type: 'toggleAdjustmentLayer',
            payload: { layerId: a.payload.layerId },
        },
        redoAction: a,
    }),
    undoable: true,
});
