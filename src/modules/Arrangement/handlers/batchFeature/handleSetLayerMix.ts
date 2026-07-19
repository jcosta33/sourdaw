import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerMix } from '../../useCases/adjustmentLayer/setLayerMix';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleSetLayerMix = createHandler<'setLayerMix'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            mutation: () => {
                setLayerMix(a.payload.layerId, a.payload.mix);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Mix',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
