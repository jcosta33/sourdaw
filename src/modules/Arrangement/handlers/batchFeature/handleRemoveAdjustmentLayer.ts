import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { removeAdjustmentLayer } from '../../useCases/adjustmentLayer/removeAdjustmentLayer';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleRemoveAdjustmentLayer = createHandler<'removeAdjustmentLayer'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            mutation: () => {
                removeAdjustmentLayer(a.payload.layerId);
            },
        });
    },
    describe: (action) => ({
        label: 'Remove Adjustment Layer',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
