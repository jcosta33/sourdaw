import {
    captureAudioSourceState,
    getAudioSourcePositionSeconds,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { captureClipAudioSource, type ClipAudioSourceFields } from '../../models/ClipAudioSource';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';

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
    return (
        captureClipAudioSource({
            ...source,
            audioOffsetSeconds: Math.max(Math.min(0, source.audioOffsetSeconds), entry),
            audioUnwrappedOffsetSeconds: unwrapped,
        }) ?? null
    );
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
