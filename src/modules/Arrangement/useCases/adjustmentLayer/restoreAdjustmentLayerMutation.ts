import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { createEffectiveAdjustmentLayerSignature } from '../../services/createEffectiveAdjustmentLayerSignature';
import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationAction = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>;

function cloneLayer(layer: RestoreAdjustmentLayerMutationAction['payload']['layers'][number]): AdjustmentLayer {
    return {
        ...layer,
        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
        affectedTrackIds: [...layer.affectedTrackIds],
        regions: layer.regions.map((region) => ({ ...region })),
    };
}

export function restoreAdjustmentLayerMutation(payload: RestoreAdjustmentLayerMutationAction['payload']): void {
    const beforeLayerState = adjustmentLayerStore.value;
    const beforeTrackState = trackStore.value;
    const beforeLayers = beforeLayerState?.layers ?? [];
    const restoredLayers = payload.layers.map(cloneLayer);

    batchStoreUpdates(() => {
        try {
            adjustmentLayerStore.set({ layers: restoredLayers });

            const trackState = trackStore.value;
            if (!trackState) {
                return;
            }
            const orderedTrackIds = trackState.tracks.map((track) => track.id);
            const previousStatusByTrackId = new Map(
                payload.freezeTransitions.map((transition) => [transition.trackId, transition.previousStatus])
            );
            const tracks = trackState.tracks.map((track) => {
                const previousStatus = previousStatusByTrackId.get(track.id);
                if (previousStatus && track.freezeState.status === 'stale') {
                    return {
                        ...track,
                        freezeState: { ...track.freezeState, status: previousStatus },
                    };
                }
                if (track.freezeState.status !== 'frozen') {
                    return track;
                }

                const beforeSignature = createEffectiveAdjustmentLayerSignature({
                    layers: beforeLayers,
                    orderedTrackIds,
                    trackId: track.id,
                });
                const restoredSignature = createEffectiveAdjustmentLayerSignature({
                    layers: restoredLayers,
                    orderedTrackIds,
                    trackId: track.id,
                });
                if (beforeSignature === restoredSignature) {
                    return track;
                }
                return {
                    ...track,
                    freezeState: { ...track.freezeState, status: 'stale' as const },
                };
            });
            if (tracks.some((track, index) => track !== trackState.tracks[index])) {
                trackStore.set({ ...trackState, tracks });
            }
        } catch (error) {
            adjustmentLayerStore.set(beforeLayerState);
            trackStore.set(beforeTrackState);
            throw error;
        }
    });
}
