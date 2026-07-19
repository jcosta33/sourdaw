import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { moveAdjustmentRegion } from '../../useCases/adjustmentLayer/moveAdjustmentRegion';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleMoveAdjustmentRegion = createHandler<'moveAdjustmentRegion'>({
    execute: (a) => {
        return commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                moveAdjustmentRegion(a.payload.regionId, a.payload.startBeat, a.payload.endBeat);
            },
        });
    },
    describe: (action) => ({
        label: 'Move Adjustment Region',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
