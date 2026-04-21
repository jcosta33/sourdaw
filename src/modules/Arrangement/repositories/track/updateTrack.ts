import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

/** Update a single track (immutable update, replaces by id). */
export function updateTrack(trackId: string, updater: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((time) => (time.id === trackId ? updater(time) : time)),
    });
}
