import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { type Clip } from '../../models/Track';

export function crossfadeClips(clipAId: string, clipBId: string, durationBeats = 0.5): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let clipA: Clip | undefined;
    let clipB: Clip | undefined;
    for (const track of state.tracks) {
        clipA = clipA ?? track.clips.find((c) => c.id === clipAId);
        clipB = clipB ?? track.clips.find((c) => c.id === clipBId);
    }
    if (!clipA || !clipB) {
        return;
    }

    const halfLen = durationBeats / 2;
    const newClipAEnd = clipA.endBeat + halfLen;
    const newClipBStart = Math.max(0, clipB.startBeat - halfLen);
    const actualOverlap = newClipAEnd - newClipBStart;

    mapAllTracks((t) => ({
        ...t,
        clips: t.clips.map((c) => {
            if (c.id === clipAId) {
                return { ...c, endBeat: newClipAEnd, fadeOutBeats: actualOverlap };
            }
            if (c.id === clipBId) {
                return { ...c, startBeat: newClipBStart, fadeInBeats: actualOverlap };
            }
            return c;
        }),
    }));
}
