import { createHandler } from '#/utils/createHandler';

import { restoreAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/restoreAdjustmentLayerMutation';

export const handleRestoreAdjustmentLayerMutationBatch = createHandler<'restoreAdjustmentLayerMutationBatch'>({
    execute: (action) => restoreAdjustmentLayerMutation(action.payload.mutations),
    describe: () => ({ label: 'Restore Adjustment Layer Mutation Batch' }),
    undoable: false,
});
