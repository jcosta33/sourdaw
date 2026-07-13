import { type Track } from '../models/Track';

export function collectTrackClipIds(track: Pick<Track, 'clips' | 'alternatives'>): string[] {
    const clipIds = new Set<string>();

    for (const clip of track.clips) {
        clipIds.add(clip.id);
    }

    for (const alternative of track.alternatives) {
        for (const clip of alternative.clips) {
            clipIds.add(clip.id);
        }
    }

    return [...clipIds];
}
