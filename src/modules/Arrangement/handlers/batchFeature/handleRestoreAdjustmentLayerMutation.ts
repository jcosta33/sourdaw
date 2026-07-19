import { createHandler } from '#/utils/createHandler';

import { restoreAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/restoreAdjustmentLayerMutation';

export const handleRestoreAdjustmentLayerMutation = createHandler<'restoreAdjustmentLayerMutation'>({
    execute: (action, context) => restoreAdjustmentLayerMutation(action.payload, context?.runSynchronousProjectCommit),
    describe: () => ({ label: 'Restore Adjustment Layer Mutation' }),
    undoable: false,
});
