import { batchStoreUpdates } from '#/infra/store/createStore';

import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore, type Track } from '../../stores/trackStore';

type CommitAdjustmentLayerMutationInput = {
    adjustmentMutationId: string;
    mutation: () => void;
};

function resolve_affected_track_ids(layer: AdjustmentLayer, tracks: readonly Track[]): string[] {
    if (layer.affectedTrackIds.length > 0) {
        const track_ids = new Set(tracks.map((track) => track.id));
        return layer.affectedTrackIds.filter((track_id) => track_ids.has(track_id));
    }

    return tracks.slice(layer.insertionIndex).map((track) => track.id);
}

function normalize_number(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function create_audible_layer_signature(
    layers: readonly AdjustmentLayer[],
    tracks: readonly Track[],
    track: Track
): string {
    return JSON.stringify(
        layers.flatMap((layer) => {
            const mix = normalize_number(layer.mix, 0, 1);
            if (!layer.enabled || mix === 0 || !resolve_affected_track_ids(layer, tracks).includes(track.id)) {
                return [];
            }
            return [
                {
                    id: layer.id,
                    effectType: layer.effectType,
                    mix,
                    parameters: layer.parameters.map((parameter) => ({
                        name: parameter.name,
                        value: normalize_number(parameter.value, parameter.min, parameter.max),
                    })),
                    regions: layer.regions.map((region) => ({
                        startBeat: region.startBeat,
                        endBeat: region.endBeat,
                        blend: region.blend,
                        fadeInBeats: Math.max(0, region.fadeInBeats),
                        fadeOutBeats: Math.max(0, region.fadeOutBeats),
                    })),
                },
            ];
        })
    );
}

export function commitAdjustmentLayerMutation({
    adjustmentMutationId,
    mutation,
}: CommitAdjustmentLayerMutationInput): void {
    const before_layer_state = adjustmentLayerStore.value;
    const before_track_state = trackStore.value;
    const before_layers = before_layer_state?.layers ?? [];

    batchStoreUpdates(() => {
        try {
            mutation();

            const after_layers = adjustmentLayerStore.value?.layers ?? [];
            const track_state = trackStore.value;
            if (!track_state) {
                return;
            }

            const affected_track_ids = new Set(
                track_state.tracks.flatMap((track) =>
                    create_audible_layer_signature(before_layers, track_state.tracks, track) !==
                    create_audible_layer_signature(after_layers, track_state.tracks, track)
                        ? [track.id]
                        : []
                )
            );
            if (affected_track_ids.size === 0) {
                return;
            }

            const tracks = track_state.tracks.map((track) => {
                if (
                    !affected_track_ids.has(track.id) ||
                    (track.freezeState.status !== 'freezing' &&
                        (!track.frozen ||
                            (track.freezeState.status !== 'frozen' && track.freezeState.status !== 'stale')))
                ) {
                    return track;
                }
                if (track.freezeState.status === 'freezing') {
                    return {
                        ...track,
                        freezeState: {
                            ...track.freezeState,
                            adjustmentLayerMutationId: adjustmentMutationId,
                        },
                    };
                }
                return {
                    ...track,
                    freezeState: {
                        ...track.freezeState,
                        status: 'stale' as const,
                        adjustmentLayerMutationId: adjustmentMutationId,
                    },
                };
            });

            if (tracks.some((track, index) => track !== track_state.tracks[index])) {
                trackStore.set({ ...track_state, tracks });
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
                throw new AggregateError([error, ...rollback_errors], 'Adjustment-layer mutation rollback failed', {
                    cause: error,
                });
            }
            throw error;
        }
    });
}
