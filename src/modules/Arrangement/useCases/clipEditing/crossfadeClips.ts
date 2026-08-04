import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

export function crossfadeClips(clipAId: string, clipBId: string, durationBeats = 0.5): boolean {
    if (clipAId === clipBId || !Number.isFinite(durationBeats) || durationBeats < 0) {
        return false;
    }

    const clipAResolution = resolveEligibleClipWriteTarget({ clipId: clipAId });
    if (clipAResolution.status !== 'eligible') {
        return false;
    }

    const clipBResolution = resolveEligibleClipWriteTarget({ clipId: clipBId });
    if (clipBResolution.status !== 'eligible') {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const clipATrack = state.tracks.find((track) => track.id === clipAResolution.trackId);
    const clipBTrack = state.tracks.find((track) => track.id === clipBResolution.trackId);
    const clipA: Clip | undefined = clipATrack?.clips.find((context) => context.id === clipAId);
    const clipB: Clip | undefined = clipBTrack?.clips.find((context) => context.id === clipBId);
    if (!clipA || !clipB) {
        return false;
    }
    if (!Number.isFinite(clipA.endBeat) || !Number.isFinite(clipB.startBeat)) {
        return false;
    }

    const halfLen = durationBeats / 2;
    const newClipAEnd = clipA.endBeat + halfLen;
    const unclampedClipBStart = clipB.startBeat - halfLen;
    const newClipBStart = Math.max(0, unclampedClipBStart);
    const actualOverlap = newClipAEnd - newClipBStart;
    if (
        !Number.isFinite(halfLen) ||
        !Number.isFinite(newClipAEnd) ||
        !Number.isFinite(unclampedClipBStart) ||
        !Number.isFinite(newClipBStart) ||
        !Number.isFinite(actualOverlap) ||
        actualOverlap < 0
    ) {
        return false;
    }
    const didChangeClipA = clipA.endBeat !== newClipAEnd || clipA.fadeOutBeats !== actualOverlap;
    const didChangeClipB = clipB.startBeat !== newClipBStart || clipB.fadeInBeats !== actualOverlap;
    if (!didChangeClipA && !didChangeClipB) {
        return false;
    }

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

    return true;
}
