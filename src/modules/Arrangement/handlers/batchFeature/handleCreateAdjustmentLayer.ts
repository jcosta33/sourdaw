import { createHandler } from '#/utils/createHandler';

import { EFFECT_PRESETS, getNextLayerId, type AdjustmentEffectType } from '../../stores/adjustmentLayer';
import { createAdjustmentLayer } from '../../useCases/adjustmentLayer/createAdjustmentLayer';

function isAdjustmentEffectType(value: string): value is AdjustmentEffectType {
    return Object.hasOwn(EFFECT_PRESETS, value);
}

export const handleCreateAdjustmentLayer = createHandler<'createAdjustmentLayer'>({
    execute: (alpha) => {
        if (!isAdjustmentEffectType(alpha.payload.effectType)) {
            throw new Error(`Unsupported adjustment effect type: ${alpha.payload.effectType}`);
        }
        alpha.payload.layerId ??= getNextLayerId();
        createAdjustmentLayer({
            name: alpha.payload.name,
            effectType: alpha.payload.effectType,
            layerId: alpha.payload.layerId,
        });
    },
    describe: () => ({ label: 'Create Adjustment Layer' }),
    undoable: false,
});
