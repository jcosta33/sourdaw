import { createHandler } from '#/utils/createHandler';

import { restoreAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/restoreAdjustmentLayerMutation';

export const handleRestoreAdjustmentLayerMutationBatch = createHandler<'restoreAdjustmentLayerMutationBatch'>({
    execute: (action, context) =>
        restoreAdjustmentLayerMutation(action.payload.mutations, context?.runSynchronousProjectCommit),
    describe: () => ({ label: 'Restore Adjustment Layer Mutation Batch' }),
    undoable: false,
});
