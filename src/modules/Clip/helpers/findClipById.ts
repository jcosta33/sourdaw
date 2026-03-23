import { getTrackState } from '#/modules/Track/repositories/trackRepository';
import { type Clip } from '#/modules/Track/models/Track';

/**
 * Finds a clip by ID across all tracks.
 */
export function findClipById(clipId: string): { clip: Clip; trackId: string } | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return { clip, trackId: track.id };
        }
    }
    return null;
}
