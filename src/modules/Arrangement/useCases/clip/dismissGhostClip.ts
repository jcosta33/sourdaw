import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../updateTrack';

/**
 * Dismiss a ghost clip, removing it without adding to the track (E1).
 */
export function dismissGhostClip(clipId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const ghost = (state.ghostClips ?? []).find((context) => context.id === clipId);
    if (!ghost) {
        // Fallback for pre-existing ghost-flag implementation
        for (const time of state.tracks) {
            if (time.clips.some((context) => context.id === clipId)) {
                updateTrack(time.id, (track) => ({
                    ...track,
                    clips: track.clips.filter((x) => x.id !== clipId),
                }));
            }
        }
        return;
    }

    trackStore.set({
        ...state,
        ghostClips: (state.ghostClips ?? []).filter((context) => context.id !== clipId),
    });
}
