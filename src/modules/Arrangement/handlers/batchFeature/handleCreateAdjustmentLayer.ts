import { createHandler } from '#/utils/createHandler';

import { type AdjustmentEffectType } from '../../stores/adjustmentLayer';
import { createAdjustmentLayer } from '../../useCases/adjustmentLayer/createAdjustmentLayer';

export const handleCreateAdjustmentLayer = createHandler<'createAdjustmentLayer'>({
    execute: (a) => {
        createAdjustmentLayer(a.payload.name, a.payload.effectType as AdjustmentEffectType);
    },
    describe: () => ({ label: 'Create Adjustment Layer' }),
    undoable: true,
});
