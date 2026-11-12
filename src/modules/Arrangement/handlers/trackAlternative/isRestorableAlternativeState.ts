import { type ClipSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type Clip, type TrackAlternative } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';

function isClip(value: unknown): value is Clip {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.trackId === 'string' &&
        isExactClipSnapshot(value, value.id, value.trackId)
    );
}

function isTrackAlternative(value: unknown): value is TrackAlternative {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        Array.isArray(value.clips) &&
        value.clips.every(isClip)
    );
}

// The contract declares only the fields the restore guard compares; the payload carries
// the whole alternatives and clips `deleteTrackAlternative` captured. These guards prove
// that before the restore writes them back, and narrow in place rather than copying
// because the track has always received the payload's own arrays.
export function isRestorableAlternatives(
    alternatives: readonly { readonly id: string }[]
): alternatives is TrackAlternative[] {
    return alternatives.every(isTrackAlternative);
}

export function isRestorableClips(clips: readonly ClipSnapshot[]): clips is Clip[] {
    return clips.every(isClip);
}
