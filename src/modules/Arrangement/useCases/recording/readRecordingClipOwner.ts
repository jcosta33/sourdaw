import { getObjectId } from '@automerge/automerge';

import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import type { trackStore } from '../../stores/trackStore';

export function readRecordingClipOwner(clipId: string) {
    const document = getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root');
    const matches =
        document?.tracks.tracks.flatMap((track) =>
            track.clips.filter((clip) => clip.id === clipId).map((clip) => ({ track, clip }))
        ) ?? [];
    if (matches.length !== 1) {
        return null;
    }
    const match = matches[0]!;
    const incarnation = getObjectId(match.clip);
    return incarnation ? { trackId: match.track.id, kind: match.track.kind, clip: match.clip, incarnation } : null;
}
