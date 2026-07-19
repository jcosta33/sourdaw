import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { type AdjustmentLayer, adjustmentLayerStore } from '../../stores/adjustmentLayer';
import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';

import { handleAddAdjustmentRegion } from './handleAddAdjustmentRegion';
import { handleCreateAdjustmentLayer } from './handleCreateAdjustmentLayer';
import { handleMoveAdjustmentRegion } from './handleMoveAdjustmentRegion';
import { handleRemoveAdjustmentLayer } from './handleRemoveAdjustmentLayer';
import { handleRemoveAdjustmentRegion } from './handleRemoveAdjustmentRegion';
import { handleRestoreAdjustmentLayerMutation } from './handleRestoreAdjustmentLayerMutation';
import { handleSetLayerAffectedTracks } from './handleSetLayerAffectedTracks';
import { handleSetLayerFades } from './handleSetLayerFades';
import { handleSetLayerInsertionIndex } from './handleSetLayerInsertionIndex';
import { handleSetLayerMix } from './handleSetLayerMix';
import { handleSetLayerParameter } from './handleSetLayerParameter';
import { handleToggleAdjustmentLayer } from './handleToggleAdjustmentLayer';

type AdjustmentLayerMutationAction = Extract<
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
type RestoreAdjustmentLayerMutationAction = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>;

const pendingInverseActions = new WeakMap<object, RestoreAdjustmentLayerMutationAction>();

function cloneLayer(layer: AdjustmentLayer): AdjustmentLayer {
    return {
        ...layer,
        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
        affectedTrackIds: [...layer.affectedTrackIds],
        regions: layer.regions.map((region) => ({ ...region })),
    };
}

function createInverseAction(): RestoreAdjustmentLayerMutationAction {
    return {
        type: 'restoreAdjustmentLayerMutation',
        payload: {
            layers: adjustmentLayerStore.value?.layers.map(cloneLayer) ?? [],
            freezeTransitions: [],
        },
    };
}

function withFreezeStaleness<Action extends AdjustmentLayerMutationAction>(
    handler: ActionHandler<Action>
): ActionHandler<Action> {
    return {
        undoable: true,
        describe: (action) => {
            const description = handler.describe(action);
            const inverseAction = createInverseAction();
            pendingInverseActions.set(action, inverseAction);
            return { ...description, inverseAction };
        },
        execute: (action) => {
            const inverseAction = pendingInverseActions.get(action);
            if (!inverseAction) {
                throw new Error(`Missing undo snapshot for ${action.type}`);
            }
            try {
                commitAdjustmentLayerMutation({
                    inverseAction,
                    mutation: () => handler.execute(action),
                });
            } finally {
                pendingInverseActions.delete(action);
            }
        },
    };
}

export const adjustmentLayerHandlers = {
    createAdjustmentLayer: withFreezeStaleness(handleCreateAdjustmentLayer),
    removeAdjustmentLayer: withFreezeStaleness(handleRemoveAdjustmentLayer),
    toggleAdjustmentLayer: withFreezeStaleness(handleToggleAdjustmentLayer),
    setLayerParameter: withFreezeStaleness(handleSetLayerParameter),
    setLayerMix: withFreezeStaleness(handleSetLayerMix),
    addAdjustmentRegion: withFreezeStaleness(handleAddAdjustmentRegion),
    removeAdjustmentRegion: withFreezeStaleness(handleRemoveAdjustmentRegion),
    moveAdjustmentRegion: withFreezeStaleness(handleMoveAdjustmentRegion),
    setLayerFades: withFreezeStaleness(handleSetLayerFades),
    setLayerAffectedTracks: withFreezeStaleness(handleSetLayerAffectedTracks),
    setLayerInsertionIndex: withFreezeStaleness(handleSetLayerInsertionIndex),
    restoreAdjustmentLayerMutation: handleRestoreAdjustmentLayerMutation,
};
