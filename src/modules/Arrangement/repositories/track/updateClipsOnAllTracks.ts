import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

/** Update clips on all tracks with a mapper function. */
export function updateClipsOnAllTracks(mapper: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((time) => ({
            ...time,
            clips: time.clips.map(mapper),
        })),
    });
}
