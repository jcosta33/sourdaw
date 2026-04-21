import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../updateTrack';

/**
 * Accept a ghost clip, making it a permanent part of the track (E1).
 */
export function acceptGhostClip(clipId: string): void {
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
                    clips: track.clips.map((context) => (context.id === clipId ? { ...context, isGhost: false } : context)),
                }));
            }
        }
        return;
    }

    const { trackId, ...clipData } = ghost;

    // 1. Add to track
    updateTrack(trackId, (time) => ({
        ...time,
        clips: [...time.clips, { ...clipData, trackId, isGhost: false }],
    }));

    // 2. Remove from ghost list (re-read after updateTrack mutated the store)
    const updated = trackStore.value!;
    trackStore.set({
        ...updated,
        ghostClips: (updated.ghostClips ?? []).filter((context) => context.id !== clipId),
    });
}
