import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';

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
                const prevTrack = previous.tracks.find((time) => time.id === track.id);
                if (!prevTrack) {
                    continue;
                }

                if (track.freezeState.status === 'frozen') {
                    if (track.clips !== prevTrack.clips || track.devices !== prevTrack.devices) {
                        const hash = await computeTrackHash(track.clips, track.devices);
                        if (hash !== track.freezeState.sourceContentHash) {
                            updateTrack(track.id, (time) => ({
                                ...time,
                                freezeState: { ...time.freezeState, status: 'stale' },
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
