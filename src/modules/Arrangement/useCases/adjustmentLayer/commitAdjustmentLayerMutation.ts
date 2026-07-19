import { batchStoreUpdates } from '#/infra/store/createStore';

import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore, type Track } from '../../stores/trackStore';

type CommitAdjustmentLayerMutationInput = {
    mutation: () => void;
};

function resolve_affected_track_ids(layer: AdjustmentLayer, tracks: readonly Track[]): string[] {
    if (layer.affectedTrackIds.length > 0) {
        const track_ids = new Set(tracks.map((track) => track.id));
        return layer.affectedTrackIds.filter((track_id) => track_ids.has(track_id));
    }

    return tracks.slice(layer.insertionIndex).map((track) => track.id);
}

function get_changed_layers(
    before: readonly AdjustmentLayer[],
    after: readonly AdjustmentLayer[]
): readonly AdjustmentLayer[] {
    const before_by_id = new Map(before.map((layer) => [layer.id, layer]));
    const after_by_id = new Map(after.map((layer) => [layer.id, layer]));
    const changed_layers: AdjustmentLayer[] = [];

    for (const layer_id of new Set([...before_by_id.keys(), ...after_by_id.keys()])) {
        const before_layer = before_by_id.get(layer_id);
        const after_layer = after_by_id.get(layer_id);
        if (before_layer === after_layer) {
            continue;
        }
        if (before_layer) {
            changed_layers.push(before_layer);
        }
        if (after_layer) {
            changed_layers.push(after_layer);
        }
    }

    return changed_layers;
}

export function commitAdjustmentLayerMutation({ mutation }: CommitAdjustmentLayerMutationInput): void {
    const before_layers = adjustmentLayerStore.value?.layers ?? [];

    batchStoreUpdates(() => {
        mutation();

        const after_layers = adjustmentLayerStore.value?.layers ?? [];
        const track_state = trackStore.value;
        if (!track_state) {
            return;
        }

        const affected_track_ids = new Set(
            get_changed_layers(before_layers, after_layers).flatMap((layer) =>
                resolve_affected_track_ids(layer, track_state.tracks)
            )
        );
        if (affected_track_ids.size === 0) {
            return;
        }

        const tracks = track_state.tracks.map((track) => {
            if (!affected_track_ids.has(track.id) || track.freezeState.status !== 'frozen') {
                return track;
            }
            return {
                ...track,
                freezeState: { ...track.freezeState, status: 'stale' as const },
            };
        });

        if (tracks.some((track, index) => track !== track_state.tracks[index])) {
            trackStore.set({ ...track_state, tracks });
        }
    });
}
