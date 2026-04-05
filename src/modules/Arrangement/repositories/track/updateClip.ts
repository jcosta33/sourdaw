import { trackStore } from '../../stores/trackStore';
import { type Clip } from '../../models/Track';

/** Update a single clip by id across all tracks. */
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === clipId ? updater(c) : c)),
        })),
    });
}
