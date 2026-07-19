import { createHandler } from '#/utils/createHandler';

import { getNextLayerId, type AdjustmentEffectType } from '../../stores/adjustmentLayer';
import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { createAdjustmentLayer } from '../../useCases/adjustmentLayer/createAdjustmentLayer';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

type CreateAdjustmentLayerAction = { payload: { layerId?: string } };

function ensure_layer_id(action: CreateAdjustmentLayerAction): string {
    action.payload.layerId ??= getNextLayerId();
    return action.payload.layerId;
}

export const handleCreateAdjustmentLayer = createHandler<'createAdjustmentLayer'>({
    execute: (alpha) => {
        commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(alpha),
            mutation: () => {
                createAdjustmentLayer(
                    alpha.payload.name,
                    alpha.payload.effectType as AdjustmentEffectType,
                    0,
                    ensure_layer_id(alpha)
                );
            },
        });
    },
    describe: (action) => {
        ensure_layer_id(action);
        return {
            label: 'Create Adjustment Layer',
            inverseAction: createAdjustmentLayerMutationInverse(action),
        };
    },
    undoable: true,
});
