import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import {
    type StripSilenceActionSnapshot,
    type TransientQuantizeMoveSnapshot,
    type TransientQuantizePlanSnapshot,
    type TransientQuantizeSkipSnapshot,
} from '#/utils/handlerContract';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';
import { quantizeBeatToGrid } from '#/utils/Music/quantizeBeatToGrid';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';
import { detectTransients } from '#/utils/transientOnsetDetection';

import { type TempoTimeline } from '../models/TempoTimeline';
import { type Clip, type Track } from '../models/Track';
import { type WarpState } from '../models/WarpMarker';
import { getTrackState } from '../repositories/track/getTrackState';
import { readClipSatelliteEntry, type ClipSatelliteEntry } from '../stores/clipSatelliteState';
import { type ClipGainEnvelope } from '../stores/gainEnvelopeStore';
import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { takeLaneStore } from '../stores/takeLaneStore';

import { readClipScopedAutomationLanes, type AutomationLaneValue } from './clip/readClipScopedAutomationLanes';
import { captureLiveTempoSourceClock } from './clipEditing/captureLiveTempoSourceClock';
import { consumedStretchFactor } from './clipEditing/consumedStretchFactor';
import { prepareAudioClipCutFields } from './clipEditing/prepareAudioClipCutFields';

type PrepareTransientQuantizeInput = {
    clipId: string;
    gridSize: number;
    strength?: number;
    swing?: number;
    sensitivity?: number;
    minConfidence?: number;
    startBeat?: number;
    endBeat?: number;
};

type TransientQuantizePreparation =
    { status: 'planned'; plan: TransientQuantizePlanSnapshot } | { status: 'refused'; reason: string };

/** Derived rather than imported: Automation owns the point model. */
type AutomationLanePoint = AutomationLaneValue['points'][number];

/** The longest source the command analyses synchronously: detection runs on the whole file. */
const MAX_SOURCE_SECONDS = 120;
/** The most onsets one command cuts; later onsets stay inside the last slice and are reported. */
const MAX_CUT_ONSETS = 256;
/** A cut whose grid point lands closer than this to the slice before it merges into that slice. */
const MIN_SLICE_BEATS = 1 / 32;
/** The declick fade every new cut edge gets, bounded by half its slice. */
const EDGE_FADE_BEATS = 1 / 256;
const MIN_GRID_BEATS = 1 / 32;
const MAX_GRID_BEATS = 4;

type Onset = { onsetIndex: number; sourceSeconds: number; beat: number; confidence: number };

/** One slice of the source: it plays from `sourceSeconds`, which sat at `fromBeat` and now starts at `toBeat`. */
type Slice = { onset: Onset | null; sourceSeconds: number; fromBeat: number; toBeat: number };

type PlacedSlice = Slice & { id: string; endBeat: number };

function refused(reason: string): TransientQuantizePreparation {
    return { status: 'refused', reason };
}

function clockTimeline(clock: TempoSourceClock): TempoTimeline {
    return {
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat, clock }),
        beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1, clock }),
        tempoAtBeat: (beat) => readTempoAtBeat({ beat, clock }),
    };
}

/** Average every channel into one analysis signal, exactly as the transient onset worker does. */
function downmix(buffer: AudioBuffer): Float32Array | null {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const mono = new Float32Array(buffer.length);
    for (let frame = 0; frame < mono.length; frame++) {
        let sum = 0;
        for (const channel of channels) {
            const sample = channel[frame];
            if (sample === undefined || !Number.isFinite(sample)) {
                return null;
            }
            sum += sample;
        }
        mono[frame] = sum / channels.length;
    }
    return mono;
}

/** The decoded source and its analysis signal, or why the command cannot analyse it. */
function readAnalysisSource(bufferId: string): { buffer: AudioBuffer; mono: Float32Array } | { reason: string } {
    const buffer = getCachedAudioBuffer({ bufferId });
    if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
        return { reason: "The clip's audio is not loaded" };
    }
    if (buffer.length / buffer.sampleRate > MAX_SOURCE_SECONDS) {
        return { reason: `Quantize transients analyses sources up to ${String(MAX_SOURCE_SECONDS)} seconds long` };
    }
    const mono = downmix(buffer);
    if (!mono) {
        return { reason: "The clip's audio holds invalid samples" };
    }
    return { buffer, mono };
}

function participatesInTakes(track: Track, clip: Clip): boolean {
    return (takeLaneStore.value?.lanes ?? []).some(
        (lane) =>
            lane.takes.some((take) => take.clipId === clip.id) ||
            (lane.trackId === track.id &&
                lane.activeCompRegions.some(
                    (region) => region.startBeat < clip.endBeat && region.endBeat > clip.startBeat
                ))
    );
}

function refusalForClip(track: Track, clip: Clip | undefined): string | null {
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return 'Quantize transients works on audio clips only';
    }
    if (clip.locked) {
        return 'The clip is locked';
    }
    if (clip.loopEnabled) {
        return 'Quantize transients cannot cut a looped clip';
    }
    if (!hasExactAudioSourceFields(clip)) {
        return 'The clip has no exact source position';
    }
    if (participatesInTakes(track, clip)) {
        return 'Quantize transients cannot cut a take or comped clip';
    }
    return null;
}

/**
 * The source second each timeline beat of the clip plays, and its inverse, read the way
 * `prepareStripSilence` reads them: a flat map divides exactly, any other map integrates.
 */
function createSourceClock(clip: Clip, timeline: TempoTimeline, clock: TempoSourceClock) {
    const stretchRatio = consumedStretchFactor(clip);
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    const pass = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: clip.endBeat - clip.startBeat,
        iterationStartBeat: clip.startBeat,
        iterationEndBeat: clip.endBeat,
        stretchRatio,
        tempoAtClipStart: tempo,
        secondsAtBeat: timeline.secondsAtBeat,
    });
    if (pass.length !== 1) {
        return null;
    }
    const sourceStartSeconds = pass[0]!.sourceStartSeconds;
    const flat = clock.changes.every((change) => change.tempo === tempo);
    const clipStartSeconds = timeline.secondsAtBeat(clip.startBeat);
    const beatAtSource = (seconds: number) => {
        const elapsed = (seconds - sourceStartSeconds) / stretchRatio;
        return flat ? clip.startBeat + (elapsed * tempo) / 60 : timeline.beatAtSeconds(clipStartSeconds + elapsed);
    };
    const sourceAtBeat = (beat: number) =>
        sourceStartSeconds +
        stretchRatio *
            (flat ? ((beat - clip.startBeat) * 60) / tempo : timeline.secondsAtBeat(beat) - clipStartSeconds);
    /** The beat where `sourceSpan` seconds of source starting at `startBeat` end. */
    const endOfSourceSpan = (startBeat: number, sourceSpan: number) => {
        if (flat) {
            return startBeat + (sourceSpan * tempo) / (60 * stretchRatio);
        }
        return timeline.beatAtSeconds(timeline.secondsAtBeat(startBeat) + sourceSpan / stretchRatio);
    };
    return {
        sourceStartSeconds,
        sourceEndSeconds: sourceStartSeconds + stretchRatio * (timeline.secondsAtBeat(clip.endBeat) - clipStartSeconds),
        beatAtSource,
        sourceAtBeat,
        endOfSourceSpan,
    };
}

type SourceClock = NonNullable<ReturnType<typeof createSourceClock>>;

function isUnitInterval(value: number | undefined): boolean {
    return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1);
}

function refusalForInput(input: PrepareTransientQuantizeInput): string | null {
    if (!Number.isFinite(input.gridSize) || input.gridSize < MIN_GRID_BEATS || input.gridSize > MAX_GRID_BEATS) {
        return `The quantize grid must be between ${String(MIN_GRID_BEATS)} and ${String(MAX_GRID_BEATS)} beats`;
    }
    if (![input.strength, input.swing, input.sensitivity, input.minConfidence].every(isUnitInterval)) {
        return 'Strength, swing, sensitivity and minimum confidence must be between 0 and 1';
    }
    const { startBeat, endBeat } = input;
    if ([startBeat, endBeat].some((beat) => beat !== undefined && !Number.isFinite(beat))) {
        return 'The quantize range must be finite';
    }
    if (startBeat !== undefined && endBeat !== undefined && endBeat <= startBeat) {
        return 'The quantize range must end after it starts';
    }
    return null;
}

function readOnsets(
    buffer: AudioBuffer,
    mono: Float32Array,
    input: PrepareTransientQuantizeInput,
    sourceClock: SourceClock
): Onset[] {
    const minConfidence = input.minConfidence ?? 0;
    const onsets: Onset[] = [];
    for (const hit of detectTransients(mono, buffer.sampleRate, input.sensitivity ?? 0.5)) {
        const sourceSeconds = hit.sampleOffset / buffer.sampleRate;
        if (
            sourceSeconds <= sourceClock.sourceStartSeconds ||
            sourceSeconds >= sourceClock.sourceEndSeconds ||
            hit.confidence < minConfidence
        ) {
            continue;
        }
        const beat = sourceClock.beatAtSource(sourceSeconds);
        if (
            (input.startBeat !== undefined && beat < input.startBeat) ||
            (input.endBeat !== undefined && beat >= input.endBeat)
        ) {
            continue;
        }
        onsets.push({ onsetIndex: onsets.length, sourceSeconds, beat, confidence: hit.confidence });
    }
    return onsets;
}

/**
 * Walk the onsets in order and keep a cut only where its grid point advances past the slice before
 * it by a minimum slice length and leaves room before the clip end (or the range end); any other
 * onset stays inside the slice before it rather than overlapping it. A range that ends inside the
 * clip gets an unmoved cut there, so the audio after it stays where it was.
 */
function compileSlices(
    clip: Clip,
    onsets: readonly Onset[],
    input: PrepareTransientQuantizeInput,
    sourceClock: SourceClock
) {
    const slices: Slice[] = [
        {
            onset: null,
            sourceSeconds: sourceClock.sourceStartSeconds,
            fromBeat: clip.startBeat,
            toBeat: clip.startBeat,
        },
    ];
    const rangeEnd =
        input.endBeat !== undefined && input.endBeat < clip.endBeat - MIN_SLICE_BEATS ? input.endBeat : null;
    const lastCutBeat = rangeEnd ?? clip.endBeat;
    const skipped: TransientQuantizeSkipSnapshot[] = [];
    for (const onset of onsets) {
        if (onset.onsetIndex >= MAX_CUT_ONSETS) {
            skipped.push({ onsetIndex: onset.onsetIndex, reason: 'limit' });
            continue;
        }
        const toBeat = quantizeBeatToGrid({
            beat: onset.beat,
            gridSize: input.gridSize,
            strength: input.strength ?? 1,
            swing: input.swing ?? 0,
        });
        const previous = slices[slices.length - 1]!;
        if (toBeat <= previous.toBeat + MIN_SLICE_BEATS || toBeat >= lastCutBeat - MIN_SLICE_BEATS) {
            skipped.push({ onsetIndex: onset.onsetIndex, reason: 'merged' });
            continue;
        }
        slices.push({ onset, sourceSeconds: onset.sourceSeconds, fromBeat: onset.beat, toBeat });
    }
    if (rangeEnd !== null) {
        slices.push({
            onset: null,
            sourceSeconds: sourceClock.sourceAtBeat(rangeEnd),
            fromBeat: rangeEnd,
            toBeat: rangeEnd,
        });
    }
    return { slices, skipped };
}

/** Where a slice's own source runs out at its new position; an unmoved slice ends where it did. */
function naturalSliceEnd(clip: Clip, slice: Slice, next: Slice | undefined, sourceClock: SourceClock): number {
    if (slice.toBeat === slice.fromBeat) {
        return next?.fromBeat ?? clip.endBeat;
    }
    const sourceEnd = next?.sourceSeconds ?? sourceClock.sourceEndSeconds;
    return sourceClock.endOfSourceSpan(slice.toBeat, sourceEnd - slice.sourceSeconds);
}

/**
 * A slice ends where its own source runs out at its new position, cut short by the next slice's
 * start so slices never overlap; a gap a later slice leaves stays silent. The last slice never
 * plays past the original clip end.
 */
function placeSlices(clip: Clip, slices: readonly Slice[], sourceClock: SourceClock): PlacedSlice[] {
    return slices.map((slice, index) => {
        const next = slices[index + 1];
        const endBeat = Math.min(naturalSliceEnd(clip, slice, next, sourceClock), next?.toBeat ?? clip.endBeat);
        const id = index === 0 ? clip.id : `clip-slice-${crypto.randomUUID()}`;
        return { ...slice, id, endBeat };
    });
}

function boundedFade(beats: number, slice: PlacedSlice): number {
    return Math.min(beats, (slice.endBeat - slice.toBeat) / 2);
}

function buildSliceClip(clip: Clip, slice: PlacedSlice, isFirst: boolean, isLast: boolean, timeline: TempoTimeline) {
    const fades = {
        fadeInBeats: boundedFade(isFirst ? clip.fadeInBeats : EDGE_FADE_BEATS, slice),
        fadeOutBeats: boundedFade(isLast ? clip.fadeOutBeats : EDGE_FADE_BEATS, slice),
    };
    if (isFirst) {
        return { ...clip, endBeat: slice.endBeat, ...fades };
    }
    const source = prepareAudioClipCutFields(clip, slice.fromBeat, slice.toBeat - slice.fromBeat);
    if (!source || source.audioOffsetSeconds === undefined) {
        return null;
    }
    const sliceClip: Clip = {
        ...clip,
        id: slice.id,
        startBeat: slice.toBeat,
        endBeat: slice.endBeat,
        ...fades,
        // Compatibility only; canonical seconds govern playback.
        audioOffsetBeats: (slice.sourceSeconds * timeline.tempoAtBeat(slice.toBeat)) / 60,
        ...source,
        // Detection owns this exact source boundary; a round trip through song beats can move it.
        audioOffsetSeconds: slice.sourceSeconds,
    };
    return sliceClip;
}

/**
 * Each slice keeps the target's gain envelope, re-keyed and shifted by where its audio sat in the
 * target, so a point stays on the moment of audio it was drawn against (`beatOffset` is clip-relative).
 */
function rebaseGainEnvelope(envelope: ClipGainEnvelope | null, clipId: string, shift: number): ClipGainEnvelope | null {
    if (!envelope) {
        return null;
    }
    return {
        clipId,
        enabled: envelope.enabled,
        points: envelope.points.map((point) => ({ ...point, beatOffset: point.beatOffset - shift })),
    };
}

/** Warp markers live in source-content beats, so every slice keeps the same set (as a split does). */
function copyWarpState(warpState: WarpState | null): WarpState | null {
    return structuredClone(warpState);
}

function movedPoints(points: readonly AutomationLanePoint[] | undefined, slice: PlacedSlice): AutomationLanePoint[] {
    const shift = slice.toBeat - slice.fromBeat;
    const playedEnd = slice.fromBeat + (slice.endBeat - slice.toBeat);
    return (points ?? [])
        .filter((point) => point.beat >= slice.fromBeat && point.beat <= playedEnd)
        .map((point) => ({ ...point, beat: point.beat + shift }));
}

/**
 * Clip-scoped lanes live in absolute beats, so each slice takes a copy holding the points over the
 * audio it plays, moved with it, as a clip move moves its points. Objects stay where they are and go
 * to the first slice they reach; content over trimmed audio retires with it, and a lane with no
 * positional content stays with the head slice.
 */
function hasPositionalContent(lane: AutomationLaneValue): boolean {
    return (
        lane.points.length > 0 ||
        (lane.trimPoints?.length ?? 0) > 0 ||
        (lane.ghostPoints?.length ?? 0) > 0 ||
        lane.objects.length > 0
    );
}

/** The copy of `lane` one slice takes, or null when none of its content plays in that slice. */
function sliceLaneCopy(
    lane: AutomationLaneValue,
    slice: PlacedSlice,
    claimedObjectIds: ReadonlySet<string>
): AutomationLaneValue | null {
    const reachedObjects = lane.objects.filter(
        (object) =>
            !claimedObjectIds.has(object.id) && object.endBeat >= slice.toBeat && object.startBeat <= slice.endBeat
    );
    const laneId = `auto-${crypto.randomUUID()}`;
    const sliceLane: AutomationLaneValue = {
        ...lane,
        id: laneId,
        clipId: slice.id,
        points: movedPoints(lane.points, slice),
        objects: reachedObjects.map((object) => ({ ...object, laneId })),
    };
    if (lane.trimPoints !== undefined) {
        sliceLane.trimPoints = movedPoints(lane.trimPoints, slice);
    }
    if (lane.ghostPoints !== undefined) {
        sliceLane.ghostPoints = movedPoints(lane.ghostPoints, slice);
    }
    return hasPositionalContent(sliceLane) ? sliceLane : null;
}

function migrateAutomationLanes(
    lanes: readonly AutomationLaneValue[],
    slices: readonly PlacedSlice[]
): AutomationLaneValue[] {
    const migrated: AutomationLaneValue[] = [];
    for (const lane of lanes) {
        const claimedObjectIds = new Set<string>();
        let placed = false;
        for (const slice of slices) {
            const sliceLane = sliceLaneCopy(lane, slice, claimedObjectIds);
            if (!sliceLane) {
                continue;
            }
            for (const object of sliceLane.objects) {
                claimedObjectIds.add(object.id);
            }
            migrated.push(sliceLane);
            placed = true;
        }
        if (!placed && !hasPositionalContent(lane)) {
            migrated.push({ ...lane, id: `auto-${crypto.randomUUID()}`, clipId: slices[0]!.id });
        }
    }
    return migrated;
}

function buildSnapshots(track: Track, clip: Clip, sliceClips: readonly Clip[], slices: readonly PlacedSlice[]) {
    const satellite = readClipSatelliteEntry(clip.id);
    const lanes = readClipScopedAutomationLanes([clip.id]);
    const newIds = slices.slice(1).map((slice) => slice.id);
    const empty = (clipId: string): ClipSatelliteEntry => ({ clipId, gainEnvelope: null, warpState: null });
    const previous: StripSilenceActionSnapshot = {
        trackId: track.id,
        clips: structuredClone([clip]),
        clipOrder: track.clips.map((candidate) => candidate.id),
        clipSatellites: [satellite, ...newIds.map(empty)],
        clipAutomationLanes: lanes,
    };
    const next: StripSilenceActionSnapshot = {
        trackId: track.id,
        clips: structuredClone([...sliceClips]),
        clipOrder: track.clips.flatMap((candidate) =>
            candidate.id === clip.id ? [clip.id, ...newIds] : [candidate.id]
        ),
        clipSatellites: slices.map((slice) => ({
            clipId: slice.id,
            gainEnvelope: rebaseGainEnvelope(satellite.gainEnvelope, slice.id, slice.fromBeat - clip.startBeat),
            warpState: copyWarpState(satellite.warpState),
        })),
        clipAutomationLanes: migrateAutomationLanes(lanes, slices),
    };
    return { previous, next };
}

/**
 * Plan one Beat Detective style separate-and-conform of an audio clip: detect onsets in its whole
 * source, cut the clip at each onset it plays and move each slice so its onset lands on the
 * quantised grid point. The plan is a clip replacement in `restoreStripSilenceState`'s shape, bound
 * to the decoded source and the tempo clock it was read against, so applying it later never detects
 * again. Gaps a slice leaves stay silent; edges the cut opens get a short declick fade.
 */
export function prepareTransientQuantize(input: PrepareTransientQuantizeInput): TransientQuantizePreparation {
    const inputRefusal = refusalForInput(input);
    if (inputRefusal) {
        return refused(inputRefusal);
    }
    const target = resolveEligibleClipWriteTarget({ clipId: input.clipId });
    const state = getTrackState();
    if (target.status !== 'eligible' || !('clipId' in target) || !state) {
        return refused('The clip cannot be edited');
    }
    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    if (!track) {
        return refused('The clip cannot be edited');
    }
    const clip = track.clips.find((candidate) => candidate.id === target.clipId);
    const clipRefusal = refusalForClip(track, clip);
    if (!clip?.audioBufferId || clipRefusal) {
        return refused(clipRefusal ?? 'The clip cannot be edited');
    }
    const audioBufferId = clip.audioBufferId;
    const analysis = readAnalysisSource(audioBufferId);
    if ('reason' in analysis) {
        return refused(analysis.reason);
    }
    const { buffer, mono } = analysis;

    const clock = captureLiveTempoSourceClock();
    const timeline = clockTimeline(clock);
    const sourceClock = createSourceClock(clip, timeline, clock);
    if (!sourceClock) {
        return refused('The clip has no exact source position');
    }
    const onsets = readOnsets(buffer, mono, input, sourceClock);
    if (onsets.length === 0) {
        return refused('No transients were found in the clip');
    }
    const { slices, skipped } = compileSlices(clip, onsets, input, sourceClock);
    if (!slices.some((slice) => slice.onset !== null)) {
        return refused('Every transient merged into the slice before it');
    }

    const placed = placeSlices(clip, slices, sourceClock);
    const sliceClips: Clip[] = [];
    for (const [index, slice] of placed.entries()) {
        const sliceClip = buildSliceClip(clip, slice, index === 0, index === placed.length - 1, timeline);
        if (!sliceClip) {
            return refused('The clip has no exact source position');
        }
        sliceClips.push(sliceClip);
    }

    const { previous, next } = buildSnapshots(track, clip, sliceClips, placed);
    const moves: TransientQuantizeMoveSnapshot[] = [];
    for (const { onset, id, sourceSeconds, fromBeat, toBeat } of placed) {
        if (onset) {
            moves.push({
                onsetIndex: onset.onsetIndex,
                sliceClipId: id,
                sourceSeconds,
                confidence: onset.confidence,
                fromBeat,
                toBeat,
            });
        }
    }
    return {
        status: 'planned',
        plan: {
            source: { audioBufferId, sampleRate: buffer.sampleRate, length: buffer.length },
            clock,
            expected: previous,
            replacement: next,
            moves,
            skipped,
        },
    };
}
