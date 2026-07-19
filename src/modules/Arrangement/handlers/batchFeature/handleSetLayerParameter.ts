import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerParameter } from '../../useCases/adjustmentLayer/setLayerParameter';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleSetLayerParameter = createHandler<'setLayerParameter'>({
    execute: (a) => {
        return commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                setLayerParameter(a.payload.layerId, a.payload.paramName, a.payload.value);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Parameter',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
