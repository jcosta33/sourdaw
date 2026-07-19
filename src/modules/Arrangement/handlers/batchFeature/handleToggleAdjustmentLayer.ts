import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { toggleAdjustmentLayer } from '../../useCases/adjustmentLayer/toggleAdjustmentLayer';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleToggleAdjustmentLayer = createHandler<'toggleAdjustmentLayer'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
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
