import { adjustmentLayerStore, createEffectiveAdjustmentLayerSignature } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';
import { freezeTaskAuthority } from '../freezeBounce/freezeTaskAuthority';
import { stabilizeInterruptedFreeze } from '../freezeBounce/stabilizeInterruptedFreeze';

/** Reconcile frozen-current claims after authoritative project/peer hydration. */
export function reconcileAdjustmentLayerStaleness(): void {
    const layer_state = adjustmentLayerStore.value;
    const track_state = trackStore.value;
    if (!track_state) {
        return;
    }

    const ordered_track_ids = track_state.tracks.map((track) => track.id);
    const tracks = track_state.tracks.map((track) => {
        if (track.freezeState.status === 'freezing' && !freezeTaskAuthority.has(track.id)) {
            return stabilizeInterruptedFreeze(track);
        }
        if (track.freezeState.status !== 'frozen') {
            return track;
        }
        const current_signature = createEffectiveAdjustmentLayerSignature(
            layer_state?.layers ?? [],
            ordered_track_ids,
            track.id
        );
        if (track.freezeState.adjustmentLayerSignature === current_signature) {
            return track;
        }
        const freeze_state = { ...track.freezeState, status: 'stale' as const };
        delete freeze_state.adjustmentLayerMutationId;
        return { ...track, freezeState: freeze_state };
    });

    if (tracks.some((track, index) => track !== track_state.tracks[index])) {
        trackStore.set({ ...track_state, tracks });
    }
}
