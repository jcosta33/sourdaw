import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function crossfadeClips(clipAId: string, clipBId: string, durationBeats = 0.5): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let clipA: Clip | undefined;
    let clipB: Clip | undefined;
    for (const track of state.tracks) {
        clipA = clipA ?? track.clips.find((context) => context.id === clipAId);
        clipB = clipB ?? track.clips.find((context) => context.id === clipBId);
    }
    if (!clipA || !clipB) {
        return;
    }

    const halfLen = durationBeats / 2;
    const newClipAEnd = clipA.endBeat + halfLen;
    const newClipBStart = Math.max(0, clipB.startBeat - halfLen);
    const actualOverlap = newClipAEnd - newClipBStart;

    mapAllTracks((time) => ({
        ...time,
        clips: time.clips.map((context) => {
            if (context.id === clipAId) {
                return { ...context, endBeat: newClipAEnd, fadeOutBeats: actualOverlap };
            }
            if (context.id === clipBId) {
                return { ...context, startBeat: newClipBStart, fadeInBeats: actualOverlap };
            }
            return context;
        }),
    }));
}
