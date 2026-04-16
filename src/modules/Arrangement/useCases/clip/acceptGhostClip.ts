import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../updateTrack';

/**
 * Accept a ghost clip, making it a permanent part of the track (E1).
 */
export function acceptGhostClip(clipId: string): void {
    const state = trackStore.value;
    if (!state) return;

    const ghost = (state.ghostClips ?? []).find((c) => c.id === clipId);
    if (!ghost) {
        // Fallback for pre-existing ghost-flag implementation
        state.tracks.forEach(t => {
            if (t.clips.some(c => c.id === clipId)) {
                updateTrack(t.id, track => ({
                    ...track,
                    clips: track.clips.map(c => c.id === clipId ? { ...c, isGhost: false } : c)
                }));
            }
        });
        return;
    }

    const { trackId, ...clipData } = ghost;
    
    // 1. Add to track
    updateTrack(trackId, (t) => ({
        ...t,
        clips: [...t.clips, { ...clipData, trackId, isGhost: false }],
    }));

    // 2. Remove from ghost list
    trackStore.set({
        ...state,
        ghostClips: (state.ghostClips ?? []).filter((c) => c.id !== clipId),
    });
}
