import {
    captureAudioSourceState,
    resolveAudioUnwrappedOffsetSeconds,
    type AudioSourceSnapshot,
} from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { captureResolvedAudioSourceSnapshot } from '../comping/captureResolvedAudioSourceSnapshot';
import { resolveCompingProgramme } from '../comping/resolveCompingProgramme';

export type AudioClipSlipSnapshot = { clip: Clip; lanes: TakeLane[] };

/** The public slip coordinate is absolute media beats under the current clip-start tempo. */
export function audioClipSlipOffsetBeats(clip: Clip, timeline: TempoTimeline): number {
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    return (resolveAudioUnwrappedOffsetSeconds(clip, tempo) * tempo) / 60;
}

function shiftedSnapshot(source: AudioSourceSnapshot, seconds: number): AudioSourceSnapshot {
    return {
        ...source,
        audioOffsetSeconds: source.audioOffsetSeconds + seconds,
        audioLoopStartSeconds: source.audioLoopStartSeconds + seconds,
        audioLoopPassEntrySeconds: source.audioLoopPassEntrySeconds + seconds,
    };
}

/** Translate media coordinates, retaining the independent first head and repeat grid. */
export function prepareAudioClipSlip(
    before: AudioClipSlipSnapshot,
    offsetBeats: number,
    timeline: TempoTimeline
): AudioClipSlipSnapshot | null {
    const clip = before.clip;
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    if (
        clip.type !== 'audio' ||
        clip.locked ||
        !Number.isFinite(offsetBeats) ||
        !Number.isFinite(tempo) ||
        tempo <= 0 ||
        !hasExactAudioSourceFields(clip) ||
        before.lanes.length > 1 ||
        before.lanes.some((lane) => lane.trackId !== clip.trackId)
    ) {
        return null;
    }
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const source = captureAudioSourceState(clip, loop.loopLengthBeats, tempo);
    if (!source) {
        return null;
    }
    const seconds = (offsetBeats * 60) / tempo - source.audioUnwrappedOffsetSeconds;
    const afterClip: Clip = {
        ...clip,
        ...source,
        audioOffsetBeats: offsetBeats,
        audioOffsetSeconds: source.audioOffsetSeconds + seconds,
        audioUnwrappedOffsetSeconds: source.audioUnwrappedOffsetSeconds + seconds,
    };
    if (source.audioLoopStartSeconds !== undefined) {
        afterClip.audioLoopStartSeconds = source.audioLoopStartSeconds + seconds;
    }
    if (source.audioLoopPassEntrySeconds !== undefined) {
        afterClip.audioLoopPassEntrySeconds = source.audioLoopPassEntrySeconds + seconds;
    }
    if (!Number.isFinite(seconds) || !hasExactAudioSourceFields(afterClip)) {
        return null;
    }
    const lanes: TakeLane[] = [];
    for (const lane of before.lanes) {
        const programme = resolveCompingProgramme(clip.trackId, [clip], { lanes: [lane] }, timeline);
        const takes = [];
        for (const take of lane.takes) {
            if (take.clipId !== clip.id || take.passAnchorSeconds === undefined) {
                takes.push(take);
                continue;
            }
            const hasBeat = Object.hasOwn(take, 'passOriginBeat');
            const hasSource = Object.hasOwn(take, 'passOriginSourceSeconds');
            if (
                hasBeat !== hasSource ||
                (hasBeat && (!Number.isFinite(take.passOriginBeat) || !Number.isFinite(take.passOriginSourceSeconds)))
            ) {
                return null;
            }
            // A legacy placed pass currently reads the beat offset, even when
            // the raw clip has newer source fields. Capture that actual basis.
            const origin = take.passOriginSourceSeconds ?? ((clip.audioOffsetBeats ?? 0) * 60) / tempo;
            const shifted = origin + seconds;
            if (!Number.isFinite(shifted)) {
                return null;
            }
            takes.push({
                ...take,
                passOriginBeat: take.passOriginBeat ?? clip.startBeat,
                passOriginSourceSeconds: shifted,
            });
        }
        const targetTakes = new Set(lane.takes.filter((take) => take.clipId === clip.id).map((take) => take.id));
        const regions = [];
        for (const region of lane.activeCompRegions) {
            const take = lane.takes.find((row) => row.id === region.takeId);
            if (!targetTakes.has(region.takeId) || take?.passAnchorSeconds !== undefined) {
                regions.push(region);
                continue;
            }
            const fragment = programme.find(
                (part) => part.id === clip.id && part.startBeat >= region.startBeat && part.endBeat <= region.endBeat
            );
            const snapshot = region.audioSource ?? (fragment && captureResolvedAudioSourceSnapshot(fragment, timeline));
            if (!snapshot) {
                // An entirely hidden selection owns no audible source to promote.
                regions.push(region);
                continue;
            }
            regions.push({ ...region, audioSource: shiftedSnapshot(snapshot, seconds) });
        }
        const gaps = (lane.baseGapAudioSources ?? []).map((tile) =>
            tile.clipId === clip.id ? { ...tile, audioSource: shiftedSnapshot(tile.audioSource, seconds) } : tile
        );
        for (const fragment of programme) {
            if (
                lane.activeCompRegions.some(
                    (region) => region.startBeat < fragment.endBeat && region.endBeat > fragment.startBeat
                ) ||
                gaps.some(
                    (tile) =>
                        tile.clipId === clip.id &&
                        tile.startBeat <= fragment.startBeat &&
                        tile.endBeat >= fragment.endBeat
                )
            ) {
                continue;
            }
            // With no mask/tiles, the raw clip itself owns the whole programme.
            if (lane.activeCompRegions.length === 0 && !lane.baseGapAudioSources?.length) {
                continue;
            }
            const snapshot = captureResolvedAudioSourceSnapshot(fragment, timeline);
            if (!snapshot) {
                return null;
            }
            gaps.push({
                clipId: clip.id,
                startBeat: fragment.startBeat,
                endBeat: fragment.endBeat,
                audioSource: shiftedSnapshot(snapshot, seconds),
            });
        }
        const next: TakeLane = { ...lane, takes, activeCompRegions: regions };
        if (gaps.length > 0 || Object.hasOwn(lane, 'baseGapAudioSources')) {
            next.baseGapAudioSources = gaps.sort(
                (a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat
            );
        }
        lanes.push(next);
    }
    return decodeExactTakeLaneSnapshots(lanes) ? { clip: afterClip, lanes } : null;
}
