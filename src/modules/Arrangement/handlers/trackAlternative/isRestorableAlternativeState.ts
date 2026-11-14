import { type ClipSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type Clip, type TrackAlternative } from '../../models/Track';
import { isClipShape } from '../../stores/isExactClipSnapshot';

function isTrackClip(value: unknown, trackId: string): value is Clip {
    return isClipShape(value) && value.trackId === trackId;
}

function isTrackAlternative(value: unknown, trackId: string): value is TrackAlternative {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        Array.isArray(value.clips) &&
        value.clips.every((clip) => isTrackClip(clip, trackId))
    );
}

// The contract declares only the fields the restore guard compares; the payload carries
// the whole alternatives and clips `deleteTrackAlternative` captured from the live track.
// These guards prove that shape before the restore writes it back, admitting every clip
// the track store holds that belongs to the restored track, and narrow in place rather
// than copying because the track has always received the payload's own arrays.
export function isRestorableAlternatives(
    alternatives: readonly { readonly id: string }[],
    trackId: string
): alternatives is TrackAlternative[] {
    return alternatives.every((alternative) => isTrackAlternative(alternative, trackId));
}

export function isRestorableClips(clips: readonly ClipSnapshot[], trackId: string): clips is Clip[] {
    return clips.every((clip) => isTrackClip(clip, trackId));
}
