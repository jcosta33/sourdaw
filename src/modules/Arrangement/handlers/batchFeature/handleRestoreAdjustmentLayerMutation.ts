import { createHandler } from '#/utils/createHandler';

import { restoreAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/restoreAdjustmentLayerMutation';

export const handleRestoreAdjustmentLayerMutation = createHandler<'restoreAdjustmentLayerMutation'>({
    execute: (action) => restoreAdjustmentLayerMutation(action.payload),
    describe: () => ({ label: 'Restore Adjustment Layer Mutation' }),
    undoable: false,
});
