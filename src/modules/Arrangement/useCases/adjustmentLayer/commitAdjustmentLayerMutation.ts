import { batchStoreUpdates } from '#/infra/store/createStore';

import { adjustmentLayerStore, createEffectiveAdjustmentLayerSignature } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';
import { freezeTaskAuthority } from '../freezeBounce/freezeTaskAuthority';
import { stabilizeInterruptedFreeze } from '../freezeBounce/stabilizeInterruptedFreeze';

type CommitAdjustmentLayerMutationInput = {
    adjustmentMutationId: string;
    mutation: () => void;
};

export function commitAdjustmentLayerMutation({ adjustmentMutationId, mutation }: CommitAdjustmentLayerMutationInput): {
    applied: boolean;
} {
    const before_layer_state = adjustmentLayerStore.value;
    const before_track_state = trackStore.value;
    const before_layers = before_layer_state?.layers ?? [];
    let applied = false;

    batchStoreUpdates(() => {
        try {
            mutation();

            const after_layers = adjustmentLayerStore.value?.layers ?? [];
            if (JSON.stringify(after_layers) === JSON.stringify(before_layers)) {
                if (adjustmentLayerStore.value !== before_layer_state) {
                    adjustmentLayerStore.set(before_layer_state);
                }
                return;
            }
            applied = true;
            const track_state = trackStore.value;
            if (!track_state) {
                return;
            }
            const ordered_track_ids = track_state.tracks.map((track) => track.id);

            const affected_track_ids = new Set(
                track_state.tracks.flatMap((track) =>
                    createEffectiveAdjustmentLayerSignature(before_layers, ordered_track_ids, track.id) !==
                    createEffectiveAdjustmentLayerSignature(after_layers, ordered_track_ids, track.id)
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
                    freezeTaskAuthority.abortTrack(track.id);
                    return stabilizeInterruptedFreeze(track, adjustmentMutationId);
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

    return { applied };
}
