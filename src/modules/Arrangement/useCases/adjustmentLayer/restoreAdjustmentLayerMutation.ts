import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerStore } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationPayload = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>['payload'];

export function restoreAdjustmentLayerMutation(payload: RestoreAdjustmentLayerMutationPayload): void {
    batchStoreUpdates(() => {
        const track_state = trackStore.value;
        if (track_state && payload.freezeStates.length > 0) {
            const freeze_states = new Map(payload.freezeStates.map((entry) => [entry.trackId, entry.freezeState]));
            trackStore.set({
                ...track_state,
                tracks: track_state.tracks.map((track) => {
                    const freeze_state = freeze_states.get(track.id);
                    return freeze_state ? { ...track, freezeState: { ...freeze_state } } : track;
                }),
            });
        }

        adjustmentLayerStore.set({
            layers: payload.layerState.layers.map((layer) => ({
                ...layer,
                parameters: layer.parameters.map((parameter) => ({ ...parameter })),
                affectedTrackIds: [...layer.affectedTrackIds],
                regions: layer.regions.map((region) => ({ ...region })),
            })),
        });
    });
}
