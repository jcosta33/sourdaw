import {
    captureAudioSourceState,
    getAudioSourcePositionSeconds,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { captureClipAudioSource, type ClipAudioSourceFields } from './clipAudioSourceFields';
import { consumedStretchFactor } from './consumedStretchFactor';

/**
 * The earliest start clip B's own media allows: only material before its entry
 * can be revealed. A canonical entry is source seconds, so its pre-roll walks
 * back through the tempo map; a legacy entry is beats. A nonpositive entry
 * (recorded leading silence) allows none, so the start holds.
 */
function crossfadeClipBEarliestStart(clipB: Clip, stretchFactor: number, timeline: TempoTimeline): number {
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
 * Clip B's canonical clock with its start moved to `startBeat`: the entry
 * continues the readers' line through the tempo map at the stretch rate, the
 * unwrapped entry moves by the song time without rate, and the repeat grid
 * (loop start, pass entry, pass origin) is materialized and kept, so passes
 * after the old start keep their source. The entry keeps the beat offset's
 * signed lower bound, never below `min(0, entry)`.
 */
function movedClipBAudioSource(clipB: Clip, startBeat: number, timeline: TempoTimeline): ClipAudioSourceFields | null {
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipB.endBeat - clipB.startBeat,
        configuredLoopLengthBeats: clipB.loopLength,
        loopEnabled: clipB.loopEnabled ?? false,
    });
    const source = captureAudioSourceState(clipB, loop.loopLengthBeats, timeline.tempoAtBeat(clipB.startBeat));
    if (!source) {
        return null;
    }
    const elapsedSeconds = timeline.secondsAtBeat(startBeat) - timeline.secondsAtBeat(clipB.startBeat);
    const entry = getAudioSourcePositionSeconds(
        source.audioOffsetSeconds,
        elapsedSeconds,
        consumedStretchFactor(clipB)
    );
    const unwrapped = source.audioUnwrappedOffsetSeconds + elapsedSeconds;
    if (!Number.isFinite(entry) || !Number.isFinite(unwrapped)) {
        return null;
    }
    return captureClipAudioSource({
        ...source,
        audioOffsetSeconds: Math.max(Math.min(0, source.audioOffsetSeconds), entry),
        audioUnwrappedOffsetSeconds: unwrapped,
    });
}

function readerSegments(clip: Clip, fromBeat: number, toBeat: number, timeline: TempoTimeline) {
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: loop.loopLengthBeats,
        iterationStartBeat: fromBeat,
        iterationEndBeat: toBeat,
        stretchRatio: consumedStretchFactor(clip),
        tempoAtClipStart: timeline.tempoAtBeat(clip.startBeat),
        secondsAtBeat: timeline.secondsAtBeat,
    });
}

const READ_TOLERANCE = 1e-9;

function readsMatch(left: ReturnType<typeof readerSegments>, right: ReturnType<typeof readerSegments>): boolean {
    return (
        left.length === right.length &&
        left.every((segment, index) => {
            const other = right[index]!;
            return (
                Math.abs(segment.startOffsetBeats - other.startOffsetBeats) <= READ_TOLERANCE &&
                Math.abs(segment.endOffsetBeats - other.endOffsetBeats) <= READ_TOLERANCE &&
                Math.abs(segment.sourceStartSeconds - other.sourceStartSeconds) <= READ_TOLERANCE
            );
        })
    );
}

type CanonicalClipBStart = { startBeat: number; audioSource: ClipAudioSourceFields };

/**
 * Where a canonical clip B may start, and the clock it then carries. The
 * readers give the entry only to the loop part holding the clip start, so a
 * retreat into an earlier part hands the old start's part to the repeat grid,
 * which holds only when the entry lies on that grid. A start is taken only
 * when every beat from the old start reads as before: the requested start,
 * else the start of the part holding the old start, else no retreat.
 */
function planCanonicalClipBStart(
    clipB: Clip,
    requestedStartBeat: number,
    timeline: TempoTimeline
): CanonicalClipBStart | null {
    const unmoved = captureClipAudioSource(clipB);
    if (!unmoved) {
        return null;
    }
    if (requestedStartBeat === clipB.startBeat) {
        return { startBeat: clipB.startBeat, audioSource: unmoved };
    }
    const readsBefore = readerSegments(clipB, clipB.startBeat, clipB.endBeat, timeline);
    const move = (startBeat: number) => {
        const audioSource = movedClipBAudioSource(clipB, startBeat, timeline);
        if (!audioSource) {
            return null;
        }
        const clip: Clip = { ...clipB, ...audioSource, startBeat };
        const holds = readsMatch(readsBefore, readerSegments(clip, clipB.startBeat, clipB.endBeat, timeline));
        return { startBeat, audioSource, clip, holds };
    };
    const requested = move(requestedStartBeat);
    if (!requested) {
        return null;
    }
    if (requested.holds) {
        return { startBeat: requested.startBeat, audioSource: requested.audioSource };
    }
    // The part holding the old start opens at the last seam cut between the two starts.
    const lead = readerSegments(requested.clip, requestedStartBeat, clipB.startBeat, timeline).at(-1);
    const atPart = lead ? move(requestedStartBeat + lead.startOffsetBeats) : null;
    if (atPart?.holds) {
        return { startBeat: atPart.startBeat, audioSource: atPart.audioSource };
    }
    return { startBeat: clipB.startBeat, audioSource: unmoved };
}

/**
 * Clip B's start and, for a canonical audio clip B, its clock after the
 * crossfade retreats it by up to `halfLen`. `audioSource` is absent for a
 * beat-only or MIDI clip B; `null` when a canonical clock cannot be read.
 */
export function resolveCrossfadeClipB(
    clipB: Clip,
    halfLen: number,
    timeline: TempoTimeline
): { startBeat: number; audioSource?: ClipAudioSourceFields } | null {
    const bound = crossfadeClipBEarliestStart(clipB, consumedStretchFactor(clipB), timeline);
    const requestedStartBeat = Math.max(clipB.startBeat - halfLen, bound);
    if (clipB.type !== 'audio' || clipB.audioOffsetSeconds === undefined) {
        return { startBeat: requestedStartBeat };
    }
    return planCanonicalClipBStart(clipB, requestedStartBeat, timeline);
}

/**
 * The loop anchor after clip B's start moves by `clipBDelta` while its legacy
 * offset moves by `contentDelta`. A canonical clock keeps its own repeat grid
 * (pass origin against anchor), so its anchor stays.
 */
export function crossfadeClipBLoopOriginEntry(clipB: Clip, clipBDelta: number, contentDelta: number) {
    if (clipB.type !== 'audio' || clipB.audioOffsetSeconds !== undefined) {
        return {};
    }
    return shiftLoopOriginEntry(clipB, clipBDelta - contentDelta);
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
    const clipBPlan = resolveCrossfadeClipB(clipB, halfLen, liveTempoTimeline);
    if (!clipBPlan) {
        return false;
    }
    const newClipBStart = clipBPlan.startBeat;
    const newAudioSource = clipBPlan.audioSource;
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
    // A canonical clock carries its own repeat grid, so its anchor stays.
    const clipBLoopOriginEntry = crossfadeClipBLoopOriginEntry(clipB, clipBDelta, contentDelta);

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
