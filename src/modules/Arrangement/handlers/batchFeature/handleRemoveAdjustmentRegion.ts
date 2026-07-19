import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { removeAdjustmentRegion } from '../../useCases/adjustmentLayer/removeAdjustmentRegion';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleRemoveAdjustmentRegion = createHandler<'removeAdjustmentRegion'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                removeAdjustmentRegion(a.payload.layerId, a.payload.regionId);
            },
        });
    },
    describe: (action) => ({
        label: 'Remove Adjustment Region',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
