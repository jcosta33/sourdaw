import { createHandler } from '#/utils/createHandler';

import { getNextRegionId } from '../../stores/adjustmentLayer';
import { addAdjustmentRegion } from '../../useCases/adjustmentLayer/addAdjustmentRegion';
import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

type AddAdjustmentRegionAction = { payload: { regionId?: string } };

function ensure_region_id(action: AddAdjustmentRegionAction): string {
    action.payload.regionId ??= getNextRegionId();
    return action.payload.regionId;
}

export const handleAddAdjustmentRegion = createHandler<'addAdjustmentRegion'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
            mutation: () => {
                addAdjustmentRegion(
                    a.payload.layerId,
                    a.payload.startBeat,
                    a.payload.endBeat,
                    a.payload.blend,
                    ensure_region_id(a)
                );
            },
        });
    },
    describe: (action) => {
        ensure_region_id(action);
        return {
            label: 'Add Adjustment Region',
            inverseAction: createAdjustmentLayerMutationInverse(action),
        };
    },
    undoable: true,
});
