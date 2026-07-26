import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

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

    const unsubscribe = trackStore.subscribe((state) => {
        void (async () => {
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
                        // A buffer baked under older freeze rules is wrong in
                        // ways no downstream fix reaches: it was cut short by a
                        // tail the device declarations never sized, and it has
                        // this track's fader and pan position printed into it,
                        // which playback then applies a second time. Re-rendering
                        // is the only remedy, so it is marked stale — the state
                        // the UI already offers a re-freeze from — regardless of
                        // whether its content changed.
                        if ((track.freezeState.renderSettings?.bakeVersion ?? 0) < FREEZE_BAKE_VERSION) {
                            updateTrack(track.id, (time) => ({
                                ...time,
                                freezeState: { ...time.freezeState, status: 'stale' },
                            }));
                            continue;
                        }

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
        })();
    });

    return unsubscribe;
}
