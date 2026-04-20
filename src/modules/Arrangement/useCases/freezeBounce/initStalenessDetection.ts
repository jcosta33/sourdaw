import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { computeTrackHash } from '../../services/computeTrackHash';
import { updateTrack } from '../../repositories/track/updateTrack';

let isEvaluating = false;
let prevState: TrackStoreState | null = null;

/**
 * Subscribes to track changes to detect when a frozen track's content
 * is modified, transitioning its state to 'stale'.
 *
 * Conforms to R8: Staleness Detection.
 */
export function initStalenessDetection(): () => void {
    prevState = trackStore.value; // capture initial state

    const unsubscribe = trackStore.subscribe(async (state) => {
        if (isEvaluating || !state || !prevState) {
            prevState = state;
            return;
        }

        isEvaluating = true;
        const previous = prevState;
        prevState = state;

        try {
            for (const track of state.tracks) {
                const prevTrack = previous.tracks.find((t) => t.id === track.id);
                if (!prevTrack) {continue;}

                // Only evaluate if the track is frozen
                if (track.freezeState.status === 'frozen') {
                    // Fast path: skip deep hash if object references haven't changed
                    if (track.clips !== prevTrack.clips || track.devices !== prevTrack.devices) {
                        const hash = await computeTrackHash(track.clips, track.devices);
                        if (hash !== track.freezeState.sourceContentHash) {
                            updateTrack(track.id, (t) => ({
                                ...t,
                                freezeState: { ...t.freezeState, status: 'stale' }
                            }));
                        }
                    }
                }
            }
        } finally {
            isEvaluating = false;
        }
    });

    return unsubscribe;
}
