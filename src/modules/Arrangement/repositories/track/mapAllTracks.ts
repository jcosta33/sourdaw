import { trackStore } from '../../stores/trackStore';
import { type Track } from '../../models/Track';

/** Update all tracks with a mapper function. */
export function mapAllTracks(mapper: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map(mapper),
    });
}
