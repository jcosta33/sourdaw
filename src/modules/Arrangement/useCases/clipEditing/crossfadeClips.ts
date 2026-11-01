import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { audioSourceAtBeat } from './audioSourceAtBeat';
import { captureClipAudioSource, type ClipAudioSourceFields } from './clipAudioSourceFields';
import { consumedStretchFactor } from './consumedStretchFactor';

/**
 * The earliest start clip B's own media allows: only material before its entry
 * can be revealed. A canonical entry is source seconds, so its pre-roll walks
 * back through the tempo map; a legacy entry is beats. A nonpositive entry
 * (recorded leading silence) allows none, so the start holds.
 */
export function crossfadeClipBEarliestStart(clipB: Clip, stretchFactor: number, timeline: TempoTimeline): number {
    if (clipB.type === 'midi') {
        return Math.max(0, clipB.startBeat - Math.max(0, clipB.midiOffsetBeats ?? 0));
    }
    if (clipB.audioOffsetSeconds === undefined) {
        return Math.max(0, clipB.startBeat - Math.max(0, clipB.audioOffsetBeats ?? 0) / stretchFactor);
    }
    const preRollSeconds = Math.max(0, clipB.audioOffsetSeconds) / stretchFactor;
    if (preRollSeconds === 0) {
        return Math.max(0, clipB.startBeat);
    }
    return Math.max(0, timeline.beatAtSeconds(timeline.secondsAtBeat(clipB.startBeat) - preRollSeconds));
}

/**
 * Clip B's canonical source clock once its start retreats to `startBeat`: the
 * readers' source at that beat, so every later beat keeps its material.
 * `undefined` for a beat-only or MIDI clip B, `null` when the clock cannot be
 * read. The entry keeps the beat offset's signed lower bound: never below
 * `min(0, entry)`, absorbing rounding at the end of a nonnegative handle.
 */
export function crossfadeClipBAudioSource(
    clipB: Clip,
    startBeat: number,
    timeline: TempoTimeline
): ClipAudioSourceFields | null | undefined {
    if (clipB.type !== 'audio' || clipB.audioOffsetSeconds === undefined) {
        return undefined;
    }
    const source = audioSourceAtBeat(clipB, startBeat, timeline);
    if (!source) {
        return null;
    }
    return captureClipAudioSource({
        ...source,
        audioOffsetSeconds: Math.max(Math.min(0, clipB.audioOffsetSeconds), source.audioOffsetSeconds),
    });
}

/**
 * Crossfade length used when a caller does not name one — a quarter-note
 * equal-power overlap reads as a musical edit at any tempo. The handler's
 * `?? ` fallback reads this same constant.
 */
export const DEFAULT_CROSSFADE_BEATS = 0.5;

export function crossfadeClips(clipAId: string, clipBId: string, durationBeats = DEFAULT_CROSSFADE_BEATS): boolean {
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
    const boundedClipBStart = crossfadeClipBEarliestStart(clipB, stretchFactor, liveTempoTimeline);
    const newClipBStart = Math.max(unclampedClipBStart, boundedClipBStart);
    const actualOverlap = newClipAEnd - newClipBStart;

    const clipBDelta = newClipBStart - clipB.startBeat;
    const contentDelta = clipBDelta * stretchFactor;
    let newAudioOffsetBeats: number | undefined;
    if (clipB.audioOffsetBeats !== undefined) {
        newAudioOffsetBeats = Math.max(Math.min(0, clipB.audioOffsetBeats), clipB.audioOffsetBeats + contentDelta);
    }
    let newMidiOffsetBeats: number | undefined;
    if (clipB.midiOffsetBeats !== undefined) {
        newMidiOffsetBeats = Math.max(0, clipB.midiOffsetBeats + clipBDelta);
    }
    const newAudioSource = crossfadeClipBAudioSource(clipB, newClipBStart, liveTempoTimeline);
    if (newAudioSource === null) {
        return false;
    }
    // The loop anchor follows the offset its clip type moves (#4988). The
    // audio offset retreats by the stretched `contentDelta` while the start
    // retreats by the raw `clipBDelta`, so the carried anchor shifts by
    // `clipBDelta - contentDelta` — zero at stretch 1 — and the region
    // `audioOffsetBeats - (startBeat - loopOriginBeat)` survives at any
    // ratio. Carried unshifted, a stretched crossfade drives the advance
    // negative and slides the region by `clipBDelta * (stretch - 1)` source
    // beats. The MIDI offset retreats by the raw delta, so its carried
    // anchor already holds and stays untouched. A negative audio offset
    // names leading silence before recorded media; the pre-roll bound keeps
    // that start fixed. Preserve its signed lower bound while retaining the
    // zero clamp for rounding at the end of a nonnegative pre-roll handle.
    const clipBLoopOriginEntry = clipB.type === 'audio' ? shiftLoopOriginEntry(clipB, clipBDelta - contentDelta) : {};

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
        (newMidiOffsetBeats !== undefined && clipB.midiOffsetBeats !== newMidiOffsetBeats) ||
        (newAudioSource !== undefined && clipB.audioOffsetSeconds !== newAudioSource.audioOffsetSeconds);
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
                    ...clipBLoopOriginEntry,
                    ...newAudioSource,
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
