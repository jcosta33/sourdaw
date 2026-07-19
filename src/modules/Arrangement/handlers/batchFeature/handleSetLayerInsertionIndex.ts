import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerInsertionIndex } from '../../useCases/adjustmentLayer/setLayerInsertionIndex';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleSetLayerInsertionIndex = createHandler<'setLayerInsertionIndex'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            mutation: () => {
                setLayerInsertionIndex(a.payload.layerId, a.payload.insertionIndex);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Insertion Index',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
