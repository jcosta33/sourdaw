import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationAction = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>;

type CommitAdjustmentLayerMutationInput = {
    inverseAction: RestoreAdjustmentLayerMutationAction;
    mutation: () => void | Promise<void>;
};

function createEffectiveLayerSignature(
    layers: readonly AdjustmentLayer[],
    orderedTrackIds: readonly string[],
    trackId: string
): string {
    const trackIndex = orderedTrackIds.indexOf(trackId);
    if (trackIndex < 0) {
        return '[]';
    }

    const effectiveLayers = layers
        .filter((layer) => {
            if (!layer.enabled) {
                return false;
            }
            if (layer.affectedTrackIds.length > 0) {
                return layer.affectedTrackIds.includes(trackId);
            }
            return trackIndex >= layer.insertionIndex;
        })
        .map((layer) => ({
            effectType: layer.effectType,
            parameters: layer.parameters,
            regions: layer.regions,
            mix: layer.mix,
        }));
    return JSON.stringify(effectiveLayers);
}

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
            const trackState = trackStore.value;
            if (!trackState) {
                return;
            }

            const orderedTrackIds = trackState.tracks.map((track) => track.id);
            const tracks = trackState.tracks.map((track) => {
                if (track.freezeState.status !== 'frozen') {
                    return track;
                }

                const beforeSignature = createEffectiveLayerSignature(beforeLayers, orderedTrackIds, track.id);
                const afterSignature = createEffectiveLayerSignature(afterLayers, orderedTrackIds, track.id);
                if (beforeSignature === afterSignature) {
                    return track;
                }

                input.inverseAction.payload.freezeTransitions.push({
                    trackId: track.id,
                    previousStatus: 'frozen',
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
