import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { type StripSilenceActionSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../models/Track';
import { type WarpMarker, type WarpState } from '../models/WarpMarker';
import { getTrackState } from '../repositories/track/getTrackState';
import { readClipSatelliteEntry, type ClipSatelliteEntry } from '../stores/clipSatelliteState';
import { type ClipGainEnvelope, type GainEnvelopePoint } from '../stores/gainEnvelopeStore';
import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';

import { readClipScopedAutomationLanes, type AutomationLaneValue } from './clip/readClipScopedAutomationLanes';

type PrepareStripSilenceInput = {
    clipId: string;
    threshold?: number;
    minDuration?: number;
};

type Region = { startSample: number; endSample: number };

/** Derived rather than imported: Automation owns the point model. */
type AutomationLanePoint = AutomationLaneValue['points'][number];

/** The played window of the target buffer, and the constants that map it. */
type PlayedWindow = {
    /** First buffer sample the clip plays. */
    startSample: number;
    /** One past the last buffer sample the clip plays. */
    endSample: number;
    /** Buffer beats per buffer sample — the frame `audioOffsetBeats` lives in. */
    bufferBeatsPerSample: number;
    /** Timeline beats per buffer beat. */
    stretchRatio: number;
    /** The clip's own `audioOffsetBeats`, in buffer beats. */
    audioOffsetBeats: number;
};

function emptySatelliteEntry(clipId: string): ClipSatelliteEntry {
    return { clipId, gainEnvelope: null, warpState: null };
}

/**
 * The portion of the buffer this clip actually plays, using the canonical
 * clip-to-buffer mapping the waveform renderer draws with
 * (`presentations/renderers/clipDrawing.ts`): `audioOffsetBeats` is a position
 * in the SOURCE buffer's own beat frame, and the clip consumes
 * `clipBeats / stretchRatio` buffer beats of it. Scanning the whole buffer
 * instead — which is what mapping `clipDurationBeats` onto `channelData.length`
 * amounts to — detects silence in audio a trimmed or stretched clip never
 * plays, and mis-scales every derived beat position.
 */
function resolvePlayedWindow(clip: Clip, buffer: AudioBuffer, bufferLength: number): PlayedWindow | null {
    const tempo = transportStore.value?.tempo ?? 120;
    const samplesPerBufferBeat = (60 / tempo) * buffer.sampleRate;
    if (!Number.isFinite(samplesPerBufferBeat) || samplesPerBufferBeat <= 0) {
        return null;
    }
    const audioOffsetBeats = clip.audioOffsetBeats ?? 0;
    const stretchRatio = Math.max(clip.stretchRatio ?? 1, 0.0001);
    const clipBeats = clip.endBeat - clip.startBeat;
    const startSample = Math.max(0, Math.floor(audioOffsetBeats * samplesPerBufferBeat));
    const consumedSamples = (clipBeats / stretchRatio) * samplesPerBufferBeat;
    // The buffer end caps the window: past it the clip plays nothing, so there
    // is no silence there to strip.
    const endSample = Math.min(bufferLength, Math.floor(startSample + consumedSamples));
    if (endSample <= startSample) {
        return null;
    }
    return {
        startSample,
        endSample,
        bufferBeatsPerSample: 1 / samplesPerBufferBeat,
        stretchRatio,
        audioOffsetBeats,
    };
}

/**
 * Every new segment inherits a copy of the target's gain envelope, re-keyed
 * to the segment and shifted so a point that lined up with a given moment of
 * audio still lines up with that same moment once the segment's own start
 * becomes beat 0 — `beatOffset` is clip-relative (see `gainEnvelopeStore`).
 * Not filtered to the segment's own span: envelope points outside a
 * segment's range are simply inert there, which keeps the split
 * non-destructive rather than silently dropping authored curve data.
 */
function rebaseGainEnvelope(
    envelope: ClipGainEnvelope | null,
    targetClipId: string,
    shift: number
): ClipGainEnvelope | null {
    if (!envelope) {
        return null;
    }
    const points: GainEnvelopePoint[] = envelope.points.map((point) => ({
        ...point,
        beatOffset: point.beatOffset - shift,
    }));
    return { clipId: targetClipId, enabled: envelope.enabled, points };
}

/**
 * Every new segment inherits a copy of the target's warp state the same way
 * as the gain envelope. Both `originalBeat` and `warpedBeat` shift by the
 * same delta as the segment's own start, a rigid translation of the marker
 * set that preserves the warp curve's shape and re-anchors it to the
 * segment's clip-relative frame.
 */
function rebaseWarpState(warpState: WarpState | null, shift: number): WarpState | null {
    if (!warpState) {
        return null;
    }
    const markers: WarpMarker[] = warpState.markers.map((marker) => ({
        ...marker,
        originalBeat: marker.originalBeat - shift,
        warpedBeat: marker.warpedBeat - shift,
    }));
    return { ...warpState, markers };
}

function pointsInsideSegment(
    points: readonly AutomationLanePoint[] | undefined,
    segment: Clip
): AutomationLanePoint[] {
    return (points ?? [])
        .filter((point) => point.beat >= segment.startBeat && point.beat <= segment.endBeat)
        .map((point) => ({ ...point }));
}

/**
 * Clip-scoped automation lanes live in the ABSOLUTE timeline frame: their
 * points carry timeline beats, and `applyAutomation` evaluates them at the
 * playhead's absolute beat while gating on the owning clip's
 * `[startBeat, endBeat]` window. So a lane survives a split by being re-keyed,
 * points untouched, to the segment whose window still covers them — never by
 * rebasing the points, which would move the curve off the audio it was drawn
 * against.
 *
 * One source lane can therefore yield one copy per segment it reaches, which
 * is the split-automation convention (Logic splits region automation with the
 * region; REAPER take envelopes travel with each split item). Content that
 * lands only in the stripped silence has no surviving clip to belong to and
 * retires with that audio; a lane with no positional content at all keeps its
 * parameter alive on the first segment.
 */
function migrateAutomationLanesToSegments(
    lanes: readonly AutomationLaneValue[],
    segments: readonly Clip[]
): AutomationLaneValue[] {
    const migrated: AutomationLaneValue[] = [];
    for (const lane of lanes) {
        const claimedObjectIds = new Set<string>();
        let placed = false;
        for (const segment of segments) {
            const points = pointsInsideSegment(lane.points, segment);
            const trimPoints = lane.trimPoints === undefined ? undefined : pointsInsideSegment(lane.trimPoints, segment);
            const ghostPoints =
                lane.ghostPoints === undefined ? undefined : pointsInsideSegment(lane.ghostPoints, segment);
            // An object is a bounded container in the same absolute frame. It
            // goes to the first segment its span reaches so its id stays
            // unique across the split.
            const objects = lane.objects
                .filter(
                    (object) =>
                        !claimedObjectIds.has(object.id) &&
                        object.endBeat >= segment.startBeat &&
                        object.startBeat <= segment.endBeat
                )
                .map((object) => ({ ...object }));
            if (
                points.length === 0 &&
                (trimPoints?.length ?? 0) === 0 &&
                (ghostPoints?.length ?? 0) === 0 &&
                objects.length === 0
            ) {
                continue;
            }
            const laneId = `auto-${crypto.randomUUID()}`;
            for (const object of objects) {
                claimedObjectIds.add(object.id);
                object.laneId = laneId;
            }
            const segmentLane: AutomationLaneValue = { ...lane, id: laneId, clipId: segment.id, points, objects };
            if (trimPoints !== undefined) {
                segmentLane.trimPoints = trimPoints;
            }
            if (ghostPoints !== undefined) {
                segmentLane.ghostPoints = ghostPoints;
            }
            migrated.push(segmentLane);
            placed = true;
        }
        const hasPositionalContent =
            lane.points.length > 0 ||
            (lane.trimPoints?.length ?? 0) > 0 ||
            (lane.ghostPoints?.length ?? 0) > 0 ||
            lane.objects.length > 0;
        if (!placed && !hasPositionalContent) {
            migrated.push({ ...lane, id: `auto-${crypto.randomUUID()}`, clipId: segments[0]!.id });
        }
    }
    return migrated;
}

function detectSoundRegions(
    channelData: Float32Array,
    threshold: number,
    sampleRate: number,
    window: PlayedWindow
): Region[] {
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.01));
    const regions: Region[] = [];
    let inSound = false;
    let regionStart = window.startSample;

    for (let index = window.startSample; index < window.endSample; index += windowSize) {
        let peak = 0;
        const end = Math.min(index + windowSize, window.endSample);
        for (let jIndex = index; jIndex < end; jIndex++) {
            const abs = Math.abs(channelData[jIndex]!);
            if (abs > peak) {
                peak = abs;
            }
        }

        if (peak > threshold) {
            if (!inSound) {
                regionStart = index;
                inSound = true;
            }
        } else if (inSound) {
            regions.push({ startSample: regionStart, endSample: index });
            inSound = false;
        }
    }
    if (inSound) {
        regions.push({ startSample: regionStart, endSample: window.endSample });
    }
    return regions;
}

function mergeCloseRegions(
    regions: readonly Region[],
    minSilenceBeats: number,
    timelineBeatsPerSample: number
): Region[] {
    const merged: Region[] = [];
    for (const region of regions) {
        const last = merged[merged.length - 1];
        if (last) {
            const gapBeats = (region.startSample - last.endSample) * timelineBeatsPerSample;
            if (gapBeats < minSilenceBeats) {
                last.endSample = region.endSample;
                continue;
            }
        }
        merged.push({ ...region });
    }
    return merged;
}

/**
 * Compute the before/after snapshot for splitting one audio clip into
 * silence-trimmed segments, including the satellite transition (ledger
 * #2108): the target's gain envelope and warp state are copied and rebased
 * onto every new segment; the target's clip-scoped automation lanes are
 * re-keyed, points verbatim, onto the segments whose windows still cover
 * them; the target id's own satellites never survive the split.
 */
export function prepareStripSilence({ clipId, threshold = -40, minDuration = 0.5 }: PrepareStripSilenceInput): {
    previous: StripSilenceActionSnapshot;
    next: StripSilenceActionSnapshot;
    newClipIds: readonly string[];
} | null {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const targetClip: Clip | undefined = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!track || !targetClip || targetClip.type !== 'audio' || !targetClip.audioBufferId) {
        return null;
    }

    const buffer = getCachedAudioBuffer({ bufferId: targetClip.audioBufferId });
    if (!buffer) {
        return null;
    }

    const thresholdLinear = 10 ** (threshold / 20);
    const channelData = buffer.getChannelData(0);
    const playedWindow = resolvePlayedWindow(targetClip, buffer, channelData.length);
    if (!playedWindow) {
        return null;
    }
    const timelineBeatsPerSample = playedWindow.bufferBeatsPerSample * playedWindow.stretchRatio;

    const regions = detectSoundRegions(channelData, thresholdLinear, buffer.sampleRate, playedWindow);
    if (regions.length <= 1) {
        return null;
    }

    const mergedRegions = mergeCloseRegions(regions, minDuration, timelineBeatsPerSample);
    if (mergedRegions.length <= 1) {
        return null;
    }

    const targetSatelliteEntry = readClipSatelliteEntry(targetClip.id);
    const targetAutomationLanes = readClipScopedAutomationLanes([targetClip.id]);

    const newClips: Clip[] = [];
    const newClipSatellites: ClipSatelliteEntry[] = [];
    for (const region of mergedRegions) {
        const newClipId = `clip-strip-${crypto.randomUUID()}`;
        // The region is measured in the buffer's own beat frame; the segment's
        // timeline position is where that audio already played, so the clip's
        // own offset comes back out and the remaining span scales by stretch.
        const regionStartBeats = region.startSample * playedWindow.bufferBeatsPerSample;
        const regionEndBeats = region.endSample * playedWindow.bufferBeatsPerSample;
        const startBeat =
            targetClip.startBeat + (regionStartBeats - playedWindow.audioOffsetBeats) * playedWindow.stretchRatio;
        const endBeat =
            targetClip.startBeat + (regionEndBeats - playedWindow.audioOffsetBeats) * playedWindow.stretchRatio;
        const shift = startBeat - targetClip.startBeat;
        newClips.push({
            ...targetClip,
            id: newClipId,
            startBeat,
            endBeat,
            audioOffsetBeats: regionStartBeats,
        });
        newClipSatellites.push({
            clipId: newClipId,
            gainEnvelope: rebaseGainEnvelope(targetSatelliteEntry.gainEnvelope, newClipId, shift),
            warpState: rebaseWarpState(targetSatelliteEntry.warpState, shift),
        });
    }

    const migratedAutomationLanes = migrateAutomationLanesToSegments(targetAutomationLanes, newClips);

    const previousClipSatellites: ClipSatelliteEntry[] = [
        targetSatelliteEntry,
        ...newClips.map((clip) => emptySatelliteEntry(clip.id)),
    ];
    const nextClipSatellites: ClipSatelliteEntry[] = [emptySatelliteEntry(targetClip.id), ...newClipSatellites];

    const clipsInTrackOrder = track.clips.filter((clip) => clip.id === targetClip.id);
    const newClipIds = newClips.map((clip) => clip.id);

    const previous: StripSilenceActionSnapshot = {
        trackId: track.id,
        clips: structuredClone(clipsInTrackOrder),
        clipOrder: track.clips.map((clip) => clip.id),
        clipSatellites: previousClipSatellites,
        clipAutomationLanes: targetAutomationLanes,
    };
    const next: StripSilenceActionSnapshot = {
        trackId: track.id,
        clips: structuredClone(newClips),
        clipOrder: track.clips.flatMap((clip) => (clip.id === targetClip.id ? newClipIds : [clip.id])),
        clipSatellites: nextClipSatellites,
        clipAutomationLanes: migratedAutomationLanes,
    };

    return { previous, next, newClipIds };
}
