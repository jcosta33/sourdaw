import { type Track } from '../models/Track';

type CollectTrackClipIdsInput = Pick<Track, 'clips'> & {
    alternatives?: unknown;
};

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function collectTrackClipIds(track: CollectTrackClipIdsInput): string[] {
    const clipIds = new Set<string>();

    for (const clip of track.clips) {
        clipIds.add(clip.id);
    }

    if (!isUnknownArray(track.alternatives)) {
        return [...clipIds];
    }

    for (const alternative of track.alternatives) {
        if (
            alternative === null ||
            typeof alternative !== 'object' ||
            !('clips' in alternative) ||
            !isUnknownArray(alternative.clips)
        ) {
            continue;
        }

        for (const clip of alternative.clips) {
            if (clip !== null && typeof clip === 'object' && 'id' in clip && typeof clip.id === 'string') {
                clipIds.add(clip.id);
            }
        }
    }

    return [...clipIds];
}
