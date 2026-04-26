import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

/** Update multiple tracks matching a predicate. */
export function updateTracks(predicate: (track: Track) => boolean, updater: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((time) => (predicate(time) ? updater(time) : time)),
    });
}
