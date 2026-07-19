import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { createEffectiveAdjustmentLayerSignature } from '../../services/createEffectiveAdjustmentLayerSignature';
import { createTrackFreezeSourceSignature } from '../../services/createTrackFreezeSourceSignature';
import { adjustmentLayerStore } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationAction = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>;

type CommitAdjustmentLayerMutationInput = {
    inverseAction: RestoreAdjustmentLayerMutationAction;
    mutation: () => void | Promise<void>;
};

function restoreStores(input: {
    layerState: typeof adjustmentLayerStore.value;
    trackState: typeof trackStore.value;
}): void {
    adjustmentLayerStore.set(input.layerState);
    trackStore.set(input.trackState);
}

export function commitAdjustmentLayerMutation(input: CommitAdjustmentLayerMutationInput): void {
    const beforeLayerState = adjustmentLayerStore.value;
    const beforeTrackState = trackStore.value;
    const beforeLayers = beforeLayerState?.layers ?? [];

    batchStoreUpdates(() => {
        try {
            const result = input.mutation();
            if (result !== undefined) {
                throw new Error('Adjustment-layer mutation handlers must be synchronous');
            }

            const afterLayers = adjustmentLayerStore.value?.layers ?? [];
            input.inverseAction.payload.expectedLayersFingerprint = JSON.stringify(afterLayers);
            const trackState = trackStore.value;
            if (!trackState) {
                return;
            }

            const orderedTrackIds = trackState.tracks.map((track) => track.id);
            const tracks = trackState.tracks.map((track) => {
                if (track.freezeState.status !== 'frozen') {
                    return track;
                }

                const beforeSignature = createEffectiveAdjustmentLayerSignature({
                    layers: beforeLayers,
                    orderedTrackIds,
                    trackId: track.id,
                });
                const afterSignature = createEffectiveAdjustmentLayerSignature({
                    layers: afterLayers,
                    orderedTrackIds,
                    trackId: track.id,
                });
                if (beforeSignature === afterSignature) {
                    return track;
                }

                input.inverseAction.payload.freezeTransitions.push({
                    trackId: track.id,
                    previousStatus: 'frozen',
                    expectedSourceSignature: createTrackFreezeSourceSignature(track),
                });
                return {
                    ...track,
                    freezeState: { ...track.freezeState, status: 'stale' as const },
                };
            });

            if (tracks.some((track, index) => track !== trackState.tracks[index])) {
                trackStore.set({ ...trackState, tracks });
            }
        } catch (error) {
            restoreStores({ layerState: beforeLayerState, trackState: beforeTrackState });
            throw error;
        }
    });
}
