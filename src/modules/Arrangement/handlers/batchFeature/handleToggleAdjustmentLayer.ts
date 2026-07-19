import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { toggleAdjustmentLayer } from '../../useCases/adjustmentLayer/toggleAdjustmentLayer';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleToggleAdjustmentLayer = createHandler<'toggleAdjustmentLayer'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                toggleAdjustmentLayer(a.payload.layerId);
            },
        });
    },
    describe: (action) => ({
        label: 'Toggle Adjustment Layer',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
