import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

import { consumedStretchFactor } from './consumedStretchFactor';

function computeMaxTimelinePreRoll(clipB: Clip, stretchFactor: number): number {
    if (clipB.type === 'midi') {
        return Math.max(0, clipB.midiOffsetBeats ?? 0);
    }
    return Math.max(0, clipB.audioOffsetBeats ?? 0) / stretchFactor;
}

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

    const stretchFactor = consumedStretchFactor(clipB);
    const maxTimelinePreRoll = computeMaxTimelinePreRoll(clipB, stretchFactor);

    const boundedClipBStart = Math.max(0, clipB.startBeat - maxTimelinePreRoll);
    const newClipBStart = Math.max(unclampedClipBStart, boundedClipBStart);
    const actualOverlap = newClipAEnd - newClipBStart;

    const clipBDelta = newClipBStart - clipB.startBeat;
    const contentDelta = clipBDelta * stretchFactor;
    const newAudioOffsetBeats =
        clipB.audioOffsetBeats !== undefined ? Math.max(0, clipB.audioOffsetBeats + contentDelta) : undefined;
    const newMidiOffsetBeats =
        clipB.midiOffsetBeats !== undefined ? Math.max(0, clipB.midiOffsetBeats + clipBDelta) : undefined;

    if (
        !Number.isFinite(halfLen) ||
        !Number.isFinite(newClipAEnd) ||
        !Number.isFinite(unclampedClipBStart) ||
        !Number.isFinite(newClipBStart) ||
        !Number.isFinite(actualOverlap) ||
        (newAudioOffsetBeats !== undefined && !Number.isFinite(newAudioOffsetBeats)) ||
        (newMidiOffsetBeats !== undefined && !Number.isFinite(newMidiOffsetBeats)) ||
        actualOverlap < 0
    ) {
        return false;
    }
    const didChangeClipA = clipA.endBeat !== newClipAEnd || clipA.fadeOutBeats !== actualOverlap;
    const didChangeClipB =
        clipB.startBeat !== newClipBStart ||
        clipB.fadeInBeats !== actualOverlap ||
        (newAudioOffsetBeats !== undefined && clipB.audioOffsetBeats !== newAudioOffsetBeats) ||
        (newMidiOffsetBeats !== undefined && clipB.midiOffsetBeats !== newMidiOffsetBeats);
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
                const updated: Clip = {
                    ...context,
                    startBeat: newClipBStart,
                    fadeInBeats: actualOverlap,
                };
                if (newAudioOffsetBeats !== undefined) {
                    updated.audioOffsetBeats = newAudioOffsetBeats;
                }
                if (newMidiOffsetBeats !== undefined) {
                    updated.midiOffsetBeats = newMidiOffsetBeats;
                }
                return updated;
            }
            return context;
        }),
    }));

    return true;
}
