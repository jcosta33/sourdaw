import { createHandler } from '#/utils/createHandler';

import { applyAdjustmentLayerMutationBatch } from '../../useCases/adjustmentLayer/applyAdjustmentLayerMutationBatch';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleApplyAdjustmentLayerMutationBatch = createHandler<'applyAdjustmentLayerMutationBatch'>({
    execute: (action) =>
        applyAdjustmentLayerMutationBatch({
            actions: action.payload.actions,
            createInverse: createAdjustmentLayerMutationInverse,
        }),
    describe: () => ({ label: 'Apply Adjustment Layer Mutation Batch' }),
    undoable: false,
});
