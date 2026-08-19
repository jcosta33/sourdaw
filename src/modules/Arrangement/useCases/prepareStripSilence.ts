import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
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

function emptySatelliteEntry(clipId: string): ClipSatelliteEntry {
    return { clipId, gainEnvelope: null, warpState: null };
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
 * same delta as the segment's `audioOffsetBeats` — a rigid translation of the
 * marker set that preserves the warp curve's shape and re-anchors it to the
 * segment's own clip-relative frame.
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

/**
 * Clip-scoped automation lanes are store-level objects with their own id, not
 * cheap per-clip metadata like gain envelope or warp state, so they are not
 * broadcast to every segment. Only the first (earliest) segment can inherit
 * one, and only when the lane's points actually land inside that segment's
 * span once rebased — a lane whose points fall entirely outside it would be
 * silently meaningless there, so it retires instead of moving somewhere it
 * cannot represent.
 */
function migrateAutomationLaneToFirstSegment(
    lane: AutomationLaneValue,
    firstSegmentClipId: string,
    shift: number,
    firstSegmentDurationBeats: number
): AutomationLaneValue | null {
    const rebasedPoints = lane.points
        .map((point) => ({ ...point, beat: point.beat - shift }))
        .sort((left, right) => left.beat - right.beat);
    const fitsFirstSegment = rebasedPoints.some((point) => point.beat >= 0 && point.beat < firstSegmentDurationBeats);
    if (!fitsFirstSegment) {
        return null;
    }
    return {
        ...lane,
        id: `auto-${crypto.randomUUID()}`,
        clipId: firstSegmentClipId,
        points: rebasedPoints,
    };
}

function detectSoundRegions(channelData: Float32Array, threshold: number, sampleRate: number): Region[] {
    const windowSize = Math.floor(sampleRate * 0.01);
    const regions: Region[] = [];
    let inSound = false;
    let regionStart = 0;

    for (let index = 0; index < channelData.length; index += windowSize) {
        let peak = 0;
        const end = Math.min(index + windowSize, channelData.length);
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
        regions.push({ startSample: regionStart, endSample: channelData.length });
    }
    return regions;
}

function mergeCloseRegions(regions: readonly Region[], minSilenceBeats: number, beatsPerSample: number): Region[] {
    const merged: Region[] = [];
    for (const region of regions) {
        const last = merged[merged.length - 1];
        if (last) {
            const gapBeats = (region.startSample - last.endSample) * beatsPerSample;
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
 * onto every new segment; the target's clip-scoped automation lanes migrate
 * (rebased) to the first segment when their points still land inside it,
 * otherwise retire; the target id's own satellites never survive the split.
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
    const clipDurationBeats = targetClip.endBeat - targetClip.startBeat;
    const beatsPerSample = clipDurationBeats / channelData.length;

    const regions = detectSoundRegions(channelData, thresholdLinear, buffer.sampleRate);
    if (regions.length <= 1) {
        return null;
    }

    const mergedRegions = mergeCloseRegions(regions, minDuration, beatsPerSample);
    if (mergedRegions.length <= 1) {
        return null;
    }

    const targetSatelliteEntry = readClipSatelliteEntry(targetClip.id);
    const targetAutomationLanes = readClipScopedAutomationLanes([targetClip.id]);

    const newClips: Clip[] = [];
    const newClipSatellites: ClipSatelliteEntry[] = [];
    for (const region of mergedRegions) {
        const newClipId = `clip-strip-${crypto.randomUUID()}`;
        const startBeat = targetClip.startBeat + region.startSample * beatsPerSample;
        const endBeat = targetClip.startBeat + region.endSample * beatsPerSample;
        const shift = startBeat - targetClip.startBeat;
        newClips.push({
            ...targetClip,
            id: newClipId,
            startBeat,
            endBeat,
            audioOffsetBeats: (targetClip.audioOffsetBeats ?? 0) + shift,
        });
        newClipSatellites.push({
            clipId: newClipId,
            gainEnvelope: rebaseGainEnvelope(targetSatelliteEntry.gainEnvelope, newClipId, shift),
            warpState: rebaseWarpState(targetSatelliteEntry.warpState, shift),
        });
    }

    const firstSegment = newClips[0]!;
    const firstSegmentShift = firstSegment.startBeat - targetClip.startBeat;
    const firstSegmentDurationBeats = firstSegment.endBeat - firstSegment.startBeat;
    const migratedAutomationLanes = targetAutomationLanes
        .map((lane) =>
            migrateAutomationLaneToFirstSegment(lane, firstSegment.id, firstSegmentShift, firstSegmentDurationBeats)
        )
        .filter((lane): lane is AutomationLaneValue => lane !== null);

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
