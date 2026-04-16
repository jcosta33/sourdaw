import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../updateTrack';

/**
 * Dismiss a ghost clip, removing it without adding to the track (E1).
 */
export function dismissGhostClip(clipId: string): void {
    const state = trackStore.value;
    if (!state) return;

    const ghost = (state.ghostClips ?? []).find((c) => c.id === clipId);
    if (!ghost) {
        // Fallback for pre-existing ghost-flag implementation
        state.tracks.forEach(t => {
            if (t.clips.some(c => c.id === clipId)) {
                updateTrack(t.id, track => ({
                    ...track,
                    clips: track.clips.filter(x => x.id !== clipId)
                }));
            }
        });
        return;
    }

    trackStore.set({
        ...state,
        ghostClips: (state.ghostClips ?? []).filter((c) => c.id !== clipId),
    });
}
