import { type AppAction } from '#/utils/handlerContract';

import { getHandler } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { executeAppAction } from '../executeAppAction';
import { generateGroupId } from '../generateGroupId';

type ReplayIdentityMap = {
    layerIds: Map<string, string>;
    regionIds: Map<string, string>;
};

type AdjustmentReplayAction = Extract<
    AppAction,
    {
        type:
            | 'createAdjustmentLayer'
            | 'removeAdjustmentLayer'
            | 'toggleAdjustmentLayer'
            | 'setLayerParameter'
            | 'setLayerMix'
            | 'addAdjustmentRegion'
            | 'removeAdjustmentRegion'
            | 'moveAdjustmentRegion'
            | 'setLayerFades'
            | 'setLayerAffectedTracks'
            | 'setLayerInsertionIndex';
    }
>;

const adjustment_replay_action_types = new Set<AppAction['type']>([
    'createAdjustmentLayer',
    'removeAdjustmentLayer',
    'toggleAdjustmentLayer',
    'setLayerParameter',
    'setLayerMix',
    'addAdjustmentRegion',
    'removeAdjustmentRegion',
    'moveAdjustmentRegion',
    'setLayerFades',
    'setLayerAffectedTracks',
    'setLayerInsertionIndex',
]);

function is_adjustment_replay_action(action: AppAction): action is AdjustmentReplayAction {
    return adjustment_replay_action_types.has(action.type);
}

function fresh_layer_id(): string {
    return `adj-${crypto.randomUUID()}`;
}

function fresh_region_id(): string {
    return `adjr-${crypto.randomUUID()}`;
}

function remap_layer_id(layer_id: string, identities: ReplayIdentityMap): string {
    return identities.layerIds.get(layer_id) ?? layer_id;
}

function remap_region_id(region_id: string, identities: ReplayIdentityMap): string {
    return identities.regionIds.get(region_id) ?? region_id;
}

function without_stale_mutation_id<Payload extends { adjustmentMutationId?: string }>(payload: Payload): Payload {
    const replay_payload = { ...payload };
    delete replay_payload.adjustmentMutationId;
    return replay_payload;
}

function create_replay_action(action: AppAction, identities: ReplayIdentityMap): AppAction {
    if (!is_adjustment_replay_action(action)) {
        return structuredClone(action);
    }

    switch (action.type) {
        case 'createAdjustmentLayer': {
            const layer_id = fresh_layer_id();
            if (action.payload.layerId) {
                identities.layerIds.set(action.payload.layerId, layer_id);
            }
            return {
                ...action,
                payload: { ...without_stale_mutation_id(action.payload), layerId: layer_id },
            };
        }
        case 'addAdjustmentRegion': {
            const region_id = fresh_region_id();
            if (action.payload.regionId) {
                identities.regionIds.set(action.payload.regionId, region_id);
            }
            return {
                ...action,
                payload: {
                    ...without_stale_mutation_id(action.payload),
                    layerId: remap_layer_id(action.payload.layerId, identities),
                    regionId: region_id,
                },
            };
        }
        case 'removeAdjustmentLayer':
        case 'toggleAdjustmentLayer':
        case 'setLayerParameter':
        case 'setLayerMix':
        case 'setLayerAffectedTracks':
        case 'setLayerInsertionIndex': {
            const replay_action = structuredClone(action);
            replay_action.payload.layerId = remap_layer_id(action.payload.layerId, identities);
            delete replay_action.payload.adjustmentMutationId;
            return replay_action;
        }
        case 'removeAdjustmentRegion':
            return {
                ...action,
                payload: {
                    ...without_stale_mutation_id(action.payload),
                    layerId: remap_layer_id(action.payload.layerId, identities),
                    regionId: remap_region_id(action.payload.regionId, identities),
                },
            };
        case 'moveAdjustmentRegion':
        case 'setLayerFades': {
            const replay_action = structuredClone(action);
            replay_action.payload.regionId = remap_region_id(action.payload.regionId, identities);
            delete replay_action.payload.adjustmentMutationId;
            return replay_action;
        }
        default: {
            const exhaustive_action: never = action;
            return exhaustive_action;
        }
    }
}

function assert_macro_actions_admitted(actions: readonly AppAction[]): void {
    for (const action of actions) {
        if (is_adjustment_replay_action(action)) {
            continue;
        }
        const admission_action = structuredClone(action);
        const handler = getHandler(admission_action);
        const undo_result = handler?.undoable ? handler.describe(admission_action) : null;
        if (!handler?.undoable || !undo_result?.inverseAction) {
            throw new Error(`Action ${action.type} cannot join an atomic group without a concrete inverse`);
        }
    }
}

/**
 * Replay a saved macro by dispatching each action in sequence.
 * All actions share a single undo group so the entire macro can be
 * undone/redone as one atomic operation.
 */
export async function playMacro(macroId: string): Promise<void> {
    const state = macroStore.value;
    if (!state) {
        return;
    }

    const macro = state.macros.find((message) => message.id === macroId);
    if (!macro) {
        return;
    }
    assert_macro_actions_admitted(macro.actions);

    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);
    const identities: ReplayIdentityMap = { layerIds: new Map(), regionIds: new Map() };

    for (const action of macro.actions) {
        await executeAppAction(create_replay_action(action, identities), { groupId, groupLabel });
    }
}
