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
            expectedLayersFingerprint: '',
            freezeTransitions: [],
        },
    };
}

function withFreezeStaleness<Action extends AdjustmentLayerMutationAction>(
    handler: ActionHandler<Action>
): ActionHandler<Action> {
    return {
        ...handler,
        undoable: true,
        describe: (action) => {
            const description = handler.describe(action);
            const inverseAction = createInverseAction();
            pendingInverseActions.set(action, inverseAction);
            return { ...description, inverseAction };
        },
        execute: (action, context) => {
            const inverseAction = pendingInverseActions.get(action);
            if (!inverseAction) {
                throw new Error(`Missing undo snapshot for ${action.type}`);
            }
            try {
                commitAdjustmentLayerMutation({
                    inverseAction,
                    mutation: () => {
                        const result = handler.execute(action, context);
                        if (result instanceof Promise) {
                            return result.then(() => undefined);
                        }
                        return undefined;
                    },
                });
            } finally {
                pendingInverseActions.delete(action);
            }
        },
    };
}

const addAdjustmentRegionWithFreezeStaleness = withFreezeStaleness(handleAddAdjustmentRegion);
const removeAdjustmentRegionWithFreezeStaleness = withFreezeStaleness(handleRemoveAdjustmentRegion);

const addAdjustmentRegionHandler: ActionHandler<Extract<AppAction, { type: 'addAdjustmentRegion' }>> = {
    undoable: true,
    validate: (action, context) => {
        if (!action.payload.expectedLayer || !action.payload.regionId) {
            return context.actions.length === 1;
        }
        return handleAddAdjustmentRegion.validate?.(action, context) ?? false;
    },
    describe: (action) => {
        if (action.payload.expectedLayer && action.payload.regionId) {
            return handleAddAdjustmentRegion.describe(action);
        }
        return addAdjustmentRegionWithFreezeStaleness.describe(action);
    },
    execute: (action, context) => {
        if (action.payload.expectedLayer && action.payload.regionId) {
            return handleAddAdjustmentRegion.execute(action, context);
        }
        return addAdjustmentRegionWithFreezeStaleness.execute(action, context);
    },
};

const removeAdjustmentRegionHandler: ActionHandler<Extract<AppAction, { type: 'removeAdjustmentRegion' }>> = {
    undoable: true,
    validate: (action, context) => {
        if (!action.payload.expectedRegion) {
            return context.actions.length === 1;
        }
        return handleRemoveAdjustmentRegion.validate?.(action, context) ?? false;
    },
    describe: (action) => {
        if (action.payload.expectedRegion) {
            return handleRemoveAdjustmentRegion.describe(action);
        }
        return removeAdjustmentRegionWithFreezeStaleness.describe(action);
    },
    execute: (action, context) => {
        if (action.payload.expectedRegion) {
            return handleRemoveAdjustmentRegion.execute(action, context);
        }
        return removeAdjustmentRegionWithFreezeStaleness.execute(action, context);
    },
};

export const adjustmentLayerHandlers = {
    createAdjustmentLayer: withFreezeStaleness(handleCreateAdjustmentLayer),
    removeAdjustmentLayer: withFreezeStaleness(handleRemoveAdjustmentLayer),
    toggleAdjustmentLayer: withFreezeStaleness(handleToggleAdjustmentLayer),
    setLayerParameter: withFreezeStaleness(handleSetLayerParameter),
    setLayerMix: withFreezeStaleness(handleSetLayerMix),
    addAdjustmentRegion: addAdjustmentRegionHandler,
    removeAdjustmentRegion: removeAdjustmentRegionHandler,
    moveAdjustmentRegion: withFreezeStaleness(handleMoveAdjustmentRegion),
    setLayerFades: withFreezeStaleness(handleSetLayerFades),
    setLayerAffectedTracks: withFreezeStaleness(handleSetLayerAffectedTracks),
    setLayerInsertionIndex: withFreezeStaleness(handleSetLayerInsertionIndex),
    restoreAdjustmentLayerMutation: handleRestoreAdjustmentLayerMutation,
};
