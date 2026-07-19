import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerFades } from '../../useCases/adjustmentLayer/setLayerFades';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleSetLayerFades = createHandler<'setLayerFades'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                setLayerFades(a.payload.regionId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Fades',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
