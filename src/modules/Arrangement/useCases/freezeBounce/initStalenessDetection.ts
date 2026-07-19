import { updateTrack } from '../../repositories/track/updateTrack';
import { computeFreezeRenderInputHash } from '../../services/computeFreezeRenderInputHash';
import { adjustmentLayerStore, createEffectiveAdjustmentLayerSignature } from '../../stores/adjustmentLayer';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';

/**
 * Subscribes to track changes to detect when a frozen track's content
 * is modified, transitioning its state to 'stale'.
 *
 * Conforms to R8: Staleness Detection.
 */
export function initStalenessDetection(): () => void {
    let evaluated_state: TrackStoreState | null = trackStore.value;
    let requested_revision = 0;
    let processed_revision = 0;
    let worker_running = false;
    let disposed = false;

    const evaluate_latest = async (): Promise<void> => {
        if (worker_running || disposed) {
            return;
        }
        worker_running = true;
        try {
            while (!disposed && processed_revision < requested_revision) {
                const revision = requested_revision;
                const state = trackStore.value;
                const previous = evaluated_state;
                evaluated_state = state;
                processed_revision = revision;
                if (!state || !previous) {
                    continue;
                }

                const ordered_track_ids = state.tracks.map((candidate) => candidate.id);
                for (const track of state.tracks) {
                    const prev_track = previous.tracks.find((candidate) => candidate.id === track.id);
                    if (
                        !prev_track ||
                        track.freezeState.status !== 'frozen' ||
                        (track.clips === prev_track.clips && track.devices === prev_track.devices)
                    ) {
                        continue;
                    }

                    const source_content_hash = track.freezeState.sourceContentHash;
                    const hash = await computeFreezeRenderInputHash(
                        track.clips,
                        track.devices,
                        createEffectiveAdjustmentLayerSignature(
                            adjustmentLayerStore.value?.layers ?? [],
                            ordered_track_ids,
                            track.id
                        )
                    );
                    if (disposed || hash === source_content_hash) {
                        continue;
                    }

                    const current_track = trackStore.value?.tracks.find((candidate) => candidate.id === track.id);
                    if (
                        !current_track ||
                        current_track.freezeState.status !== 'frozen' ||
                        current_track.freezeState.sourceContentHash !== source_content_hash ||
                        current_track.clips !== track.clips ||
                        current_track.devices !== track.devices
                    ) {
                        continue;
                    }
                    updateTrack(track.id, (current) => {
                        if (
                            current.freezeState.status !== 'frozen' ||
                            current.freezeState.sourceContentHash !== source_content_hash ||
                            current.clips !== track.clips ||
                            current.devices !== track.devices
                        ) {
                            return current;
                        }
                        return { ...current, freezeState: { ...current.freezeState, status: 'stale' } };
                    });
                }
            }
        } finally {
            worker_running = false;
            if (!disposed && processed_revision < requested_revision) {
                void evaluate_latest();
            }
        }
    };

    const unsubscribe = trackStore.subscribe(() => {
        requested_revision += 1;
        void evaluate_latest();
    });

    return () => {
        disposed = true;
        unsubscribe();
    };
}
