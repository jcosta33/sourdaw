import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AdjustmentLayerMutationAction, type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerStore, type AdjustmentEffectType } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

import { addAdjustmentRegion } from './addAdjustmentRegion';
import { commitAdjustmentLayerMutation } from './commitAdjustmentLayerMutation';
import { createAdjustmentLayer } from './createAdjustmentLayer';
import { moveAdjustmentRegion } from './moveAdjustmentRegion';
import { removeAdjustmentLayer } from './removeAdjustmentLayer';
import { removeAdjustmentRegion } from './removeAdjustmentRegion';
import { setLayerAffectedTracks } from './setLayerAffectedTracks';
import { setLayerFades } from './setLayerFades';
import { setLayerInsertionIndex } from './setLayerInsertionIndex';
import { setLayerMix } from './setLayerMix';
import { setLayerParameter } from './setLayerParameter';
import { toggleAdjustmentLayer } from './toggleAdjustmentLayer';

function require_identity(value: string | undefined, label: string): string {
    if (!value) {
        throw new Error(`${label} is required for adjustment-layer batch replay`);
    }
    return value;
}

function apply_action(action: AdjustmentLayerMutationAction): { applied: boolean } {
    action.payload.adjustmentMutationId ??= crypto.randomUUID();
    return commitAdjustmentLayerMutation({
        adjustmentMutationId: action.payload.adjustmentMutationId,
        mutation: () => {
            switch (action.type) {
                case 'createAdjustmentLayer':
                    createAdjustmentLayer(
                        action.payload.name,
                        action.payload.effectType as AdjustmentEffectType,
                        0,
                        require_identity(action.payload.layerId, 'Layer id')
                    );
                    return;
                case 'removeAdjustmentLayer':
                    removeAdjustmentLayer(action.payload.layerId);
                    return;
                case 'toggleAdjustmentLayer':
                    toggleAdjustmentLayer(action.payload.layerId);
                    return;
                case 'setLayerParameter':
                    setLayerParameter(action.payload.layerId, action.payload.paramName, action.payload.value);
                    return;
                case 'setLayerMix':
                    setLayerMix(action.payload.layerId, action.payload.mix);
                    return;
                case 'addAdjustmentRegion':
                    addAdjustmentRegion(
                        action.payload.layerId,
                        action.payload.startBeat,
                        action.payload.endBeat,
                        action.payload.blend,
                        require_identity(action.payload.regionId, 'Region id')
                    );
                    return;
                case 'removeAdjustmentRegion':
                    removeAdjustmentRegion(action.payload.layerId, action.payload.regionId);
                    return;
                case 'moveAdjustmentRegion':
                    moveAdjustmentRegion(action.payload.regionId, action.payload.startBeat, action.payload.endBeat);
                    return;
                case 'setLayerFades':
                    setLayerFades(action.payload.regionId, action.payload.fadeInBeats, action.payload.fadeOutBeats);
                    return;
                case 'setLayerAffectedTracks':
                    setLayerAffectedTracks(action.payload.layerId, action.payload.trackIds);
                    return;
                case 'setLayerInsertionIndex':
                    setLayerInsertionIndex(action.payload.layerId, action.payload.insertionIndex);
                    return;
                default: {
                    const exhaustive_action: never = action;
                    throw new Error(`Unsupported adjustment-layer batch action: ${String(exhaustive_action)}`);
                }
            }
        },
    });
}

type ApplyAdjustmentLayerMutationBatchInput = {
    actions: readonly AdjustmentLayerMutationAction[];
    createInverse: (action: AdjustmentLayerMutationAction) => AppAction;
};

export function applyAdjustmentLayerMutationBatch({ actions, createInverse }: ApplyAdjustmentLayerMutationBatchInput): {
    applied: boolean;
    inverseActions: AppAction[];
} {
    const before_layer_state = adjustmentLayerStore.value;
    const before_track_state = trackStore.value;
    let applied = false;
    const inverse_actions: AppAction[] = [];

    batchStoreUpdates(() => {
        try {
            for (const action of actions) {
                inverse_actions.push(createInverse(action));
                applied = apply_action(action).applied || applied;
            }
        } catch (error) {
            const rollback_errors: unknown[] = [];
            if (adjustmentLayerStore.value !== before_layer_state) {
                try {
                    adjustmentLayerStore.set(before_layer_state);
                } catch (rollback_error) {
                    rollback_errors.push(rollback_error);
                }
            }
            if (trackStore.value !== before_track_state) {
                try {
                    trackStore.set(before_track_state);
                } catch (rollback_error) {
                    rollback_errors.push(rollback_error);
                }
            }
            if (rollback_errors.length > 0) {
                throw new AggregateError([error, ...rollback_errors], 'Adjustment-layer batch replay rollback failed', {
                    cause: error,
                });
            }
            throw error;
        }
    });

    return { applied, inverseActions: inverse_actions };
}
