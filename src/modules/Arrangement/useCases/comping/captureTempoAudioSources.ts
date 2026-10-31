import { captureAudioSourceState } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';
import { getTempoAudioSourceRequirements } from '#/utils/tempoAudioSourceCoverage';

import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip, type Track } from '../../models/Track';
import {
    captureTempoSourceFields,
    tempoClipSourceFields,
    tempoClipOptionalInputs,
    tempoTakeSourceFields,
    tempoTakeOptionalInputs,
} from '../../stores/tempoAudioSources';

import { captureResolvedAudioSourceSnapshot } from './captureResolvedAudioSourceSnapshot';
import { resolveCompingProgramme } from './resolveCompingProgramme';

type CaptureContext = {
    tracks: readonly Track[];
    lanes: readonly TakeLane[];
    timeline: TempoTimeline;
    requirements: NonNullable<ReturnType<typeof getTempoAudioSourceRequirements>>;
    clips: TempoAudioSourcePromotionSnapshot['clips'][number][];
    takes: TempoAudioSourcePromotionSnapshot['takes'][number][];
    regions: TempoAudioSourcePromotionSnapshot['regions'][number][];
    gaps: TempoAudioSourcePromotionSnapshot['gaps'][number][];
    gapFieldPresence: TempoAudioSourcePromotionSnapshot['gapFieldPresence'][number][];
};
type Collection = { collection: 'active' | 'alternative'; alternativeId: string; clips: Clip[] };
function captureLaneTakes(
    track: Track,
    collection: Collection,
    lane: TakeLane,
    byId: Map<string, Clip>,
    sources: Map<string, TempoAudioSourcePromotionSnapshot['clips'][number]>,
    needed: Set<string>,
    context: CaptureContext
): boolean {
    const { timeline, requirements, takes } = context;
    for (const take of lane.takes) {
        const clip = byId.get(take.clipId);
        const source = sources.get(take.clipId);
        if (!clip || !source) {
            continue;
        }
        const capture = requirements.takes.find(
            (candidate) =>
                candidate.trackId === track.id &&
                candidate.collection === collection.collection &&
                candidate.alternativeId === collection.alternativeId &&
                candidate.laneId === lane.id &&
                candidate.takeId === take.id
        );
        if (!capture) {
            continue;
        }
        const before = captureTempoSourceFields(take, tempoTakeSourceFields);
        const after = structuredClone(before);
        if (capture.depth && take.sourceOffsetBeats !== undefined) {
            after.sourceOffsetSeconds = (take.sourceOffsetBeats * 60) / timeline.tempoAtBeat(clip.startBeat);
        }
        if (capture.origin) {
            if (source.after.audioUnwrappedOffsetSeconds === undefined) {
                return false;
            }
            after.passOriginBeat = clip.startBeat;
            after.passOriginSourceSeconds = source.after.audioUnwrappedOffsetSeconds;
        }
        if (valuesEqual(before, after)) {
            continue;
        }
        needed.add(clip.id);
        takes.push({
            trackId: track.id,
            laneId: lane.id,
            takeId: take.id,
            clipId: clip.id,
            inputs: {
                startBeat: take.startBeat,
                endBeat: take.endBeat,
                ...captureTempoSourceFields(take, tempoTakeOptionalInputs),
            },
            before,
            after,
        });
    }
    return true;
}

function captureLaneRegions(
    track: Track,
    collection: Collection,
    lane: TakeLane,
    byId: Map<string, Clip>,
    programme: ReturnType<typeof resolveCompingProgramme>,
    needed: Set<string>,
    context: CaptureContext
): boolean {
    const { timeline, requirements, regions } = context;
    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId);
        if (
            !take ||
            !byId.has(take.clipId) ||
            !requirements.regions.some(
                (candidate) =>
                    candidate.trackId === track.id &&
                    candidate.collection === collection.collection &&
                    candidate.alternativeId === collection.alternativeId &&
                    candidate.laneId === lane.id &&
                    candidate.takeId === take.id &&
                    candidate.startBeat === region.startBeat &&
                    candidate.endBeat === region.endBeat
            )
        ) {
            continue;
        }
        const fragment = programme.find(
            (part) => part.id === take.clipId && part.startBeat >= region.startBeat && part.endBeat <= region.endBeat
        );
        if (!fragment) {
            continue;
        }
        const source = captureResolvedAudioSourceSnapshot(fragment, timeline);
        if (!source) {
            return false;
        }
        needed.add(take.clipId);
        regions.push({
            trackId: track.id,
            laneId: lane.id,
            takeId: take.id,
            clipId: take.clipId,
            startBeat: region.startBeat,
            endBeat: region.endBeat,
            before: { present: false },
            after: { present: true, value: source },
        });
    }
    return true;
}

function captureLane(
    track: Track,
    collection: Collection,
    lane: TakeLane,
    byId: Map<string, Clip>,
    sources: Map<string, TempoAudioSourcePromotionSnapshot['clips'][number]>,
    needed: Set<string>,
    context: CaptureContext
): boolean {
    const { timeline, requirements, gaps, gapFieldPresence } = context;
    if (!captureLaneTakes(track, collection, lane, byId, sources, needed, context)) {
        return false;
    }
    const programme = resolveCompingProgramme(track.id, collection.clips, { lanes: [lane] }, timeline);
    if (!captureLaneRegions(track, collection, lane, byId, programme, needed, context)) {
        return false;
    }
    // With no comp mask or existing tiles the whole clip owns its entry.
    if (lane.activeCompRegions.length === 0 && !lane.baseGapAudioSources?.length) {
        return true;
    }
    const laneGapStart = gaps.length;
    for (const fragment of programme) {
        if (
            fragment.type !== 'audio' ||
            !requirements.gaps.some(
                (candidate) =>
                    candidate.trackId === track.id &&
                    candidate.collection === collection.collection &&
                    candidate.alternativeId === collection.alternativeId &&
                    candidate.laneId === lane.id &&
                    candidate.clipId === fragment.id &&
                    candidate.startBeat === fragment.startBeat &&
                    candidate.endBeat === fragment.endBeat
            )
        ) {
            continue;
        }
        const source = captureResolvedAudioSourceSnapshot(fragment, timeline);
        if (!source) {
            return false;
        }
        needed.add(fragment.id);
        gaps.push({
            trackId: track.id,
            laneId: lane.id,
            clipId: fragment.id,
            startBeat: fragment.startBeat,
            endBeat: fragment.endBeat,
            before: { present: false },
            after: { present: true, value: source },
        });
    }
    if (gaps.length !== laneGapStart && !gapFieldPresence.some((presence) => presence.laneId === lane.id)) {
        gapFieldPresence.push({
            trackId: track.id,
            laneId: lane.id,
            before: lane.baseGapAudioSources !== undefined,
            after: true,
        });
    }
    return true;
}

function captureCollection(
    track: Track,
    collection: Collection,
    trackLanes: TakeLane[],
    context: CaptureContext
): boolean {
    const { timeline, requirements, clips } = context;
    const audioClips = collection.clips.filter((clip) => clip.type === 'audio');
    const byId = new Map<string, Clip>(audioClips.map((clip) => [clip.id, clip]));
    const sources = new Map<string, TempoAudioSourcePromotionSnapshot['clips'][number]>();
    for (const clip of audioClips) {
        const loop = projectClipLoopExpansion({
            clipDurationBeats: clip.endBeat - clip.startBeat,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: clip.loopEnabled ?? false,
        });
        const source = captureAudioSourceState(clip, loop.loopLengthBeats, timeline.tempoAtBeat(clip.startBeat));
        if (!source) {
            return false;
        }
        sources.set(clip.id, {
            trackId: track.id,
            collection: collection.collection,
            alternativeId: collection.alternativeId,
            clipId: clip.id,
            inputs: {
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                ...captureTempoSourceFields(clip, tempoClipOptionalInputs),
            },
            before: captureTempoSourceFields(clip, tempoClipSourceFields),
            after: source,
        });
    }
    const needed = new Set<string>();
    for (const lane of trackLanes) {
        if (!captureLane(track, collection, lane, byId, sources, needed, context)) {
            return false;
        }
    }
    for (const source of sources.values()) {
        if (
            needed.has(source.clipId) ||
            requirements.clips.some(
                (candidate) =>
                    candidate.trackId === track.id &&
                    candidate.collection === collection.collection &&
                    candidate.alternativeId === collection.alternativeId &&
                    candidate.clipId === source.clipId
            )
        ) {
            clips.push(source);
        }
    }
    return true;
}

function captureTrack(track: Track, context: CaptureContext): boolean {
    const { lanes } = context;
    const collections: { collection: 'active' | 'alternative'; alternativeId: string; clips: Clip[] }[] = [
        { collection: 'active', alternativeId: track.activeAlternativeId, clips: track.clips },
    ];
    for (const alternative of track.alternatives) {
        // Switching overwrites this stored copy from active track.clips.
        if (alternative.id !== track.activeAlternativeId) {
            collections.push({
                collection: 'alternative',
                alternativeId: alternative.id,
                clips: alternative.clips,
            });
        }
    }
    const trackLanes = lanes.filter((candidate) => candidate.trackId === track.id);
    const clipOwnerCounts = new Map<string, number>();
    for (const collection of collections) {
        for (const clip of collection.clips) {
            clipOwnerCounts.set(clip.id, (clipOwnerCounts.get(clip.id) ?? 0) + 1);
        }
    }
    if (trackLanes.some((lane) => lane.takes.some((take) => (clipOwnerCounts.get(take.clipId) ?? 0) > 1))) {
        return false;
    }
    if (
        trackLanes.some((lane) => lane.activeCompRegions.length > 0 || lane.baseGapAudioSources?.length) &&
        collections.some((collection) =>
            collection.clips.some((clip) => clip.type === 'audio' && (clipOwnerCounts.get(clip.id) ?? 0) > 1)
        )
    ) {
        return false;
    }
    for (const collection of collections) {
        if (!captureCollection(track, collection, trackLanes, context)) {
            return false;
        }
    }
    return true;
}

/** The old map and current live values are explicit; this path never reads Transport. */
export function captureTempoAudioSources(
    tracks: readonly Track[],
    lanes: readonly TakeLane[],
    timeline: TempoTimeline
): TempoAudioSourcePromotionSnapshot | null {
    const requirements = getTempoAudioSourceRequirements({ tracks: { tracks }, takeLanes: { lanes } });
    if (!requirements) {
        return null;
    }
    const clips: TempoAudioSourcePromotionSnapshot['clips'][number][] = [];
    const takes: TempoAudioSourcePromotionSnapshot['takes'][number][] = [];
    const regions: TempoAudioSourcePromotionSnapshot['regions'][number][] = [];
    const gaps: TempoAudioSourcePromotionSnapshot['gaps'][number][] = [];
    const gapFieldPresence: TempoAudioSourcePromotionSnapshot['gapFieldPresence'][number][] = [];
    const context = { tracks, lanes, timeline, requirements, clips, takes, regions, gaps, gapFieldPresence };
    for (const track of tracks) {
        if (!captureTrack(track, context)) {
            return null;
        }
    }
    return { version: 1, clips, takes, regions, gaps, gapFieldPresence };
}
