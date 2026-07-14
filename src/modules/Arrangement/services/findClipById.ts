import { type Clip, type Track } from '../models/Track';

type FindClipByIdInput = {
    clipId: string;
    tracks: readonly Pick<Track, 'id' | 'clips'>[];
};

/**
 * Finds a clip by ID across all tracks.
 */
export function findClipById({ clipId, tracks }: FindClipByIdInput): { clip: Clip; trackId: string } | null {
    for (const track of tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
        if (clip) {
            return { clip, trackId: track.id };
        }
    }
    return null;
}
