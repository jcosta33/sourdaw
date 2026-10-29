import { type AudioSourceTile } from '#/utils/audioSourceTime';
import {
    type TempoAudioClipFieldsSnapshot,
    type TempoAudioSourcePresenceSnapshot,
    type TempoAudioSourcePromotionSnapshot,
    type TempoAudioTakeFieldsSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take, type TakeLane } from '../models/TakeLane';
import { type Clip, type Track } from '../models/Track';

import {
    captureBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
    replaceBaseGapAudioSources,
    type OptionalAudioSourceTiles,
} from './baseGapAudioSourceDelta';

export const tempoClipSourceFields = [
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
] as const;
export const tempoClipOptionalInputs = [
    'audioBufferId',
    'assetHash',
    'audioOffsetBeats',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
] as const;
export const tempoTakeSourceFields = ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds'] as const;
export const tempoTakeOptionalInputs = [
    'sourceOffsetBeats',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
] as const;

export function captureTempoSourceFields<Value, Key extends keyof Value>(value: Value, keys: readonly Key[]) {
    const result: Partial<Pick<Value, Key>> = {};
    for (const key of keys) {
        if (value[key] !== undefined) {
            result[key] = value[key];
        }
    }
    return result;
}

function withClipSource(clip: Clip, fields: TempoAudioClipFieldsSnapshot): Clip {
    const next = { ...clip, ...fields };
    for (const field of tempoClipSourceFields) {
        if (fields[field] === undefined) {
            delete next[field];
        }
    }
    return next;
}

function withTakeSource(take: Take, fields: TempoAudioTakeFieldsSnapshot): Take {
    const next = { ...take, ...fields };
    for (const field of tempoTakeSourceFields) {
        if (fields[field] === undefined) {
            delete next[field];
        }
    }
    return next;
}

export function withRegionSource(region: CompRegion, source: TempoAudioSourcePresenceSnapshot): CompRegion {
    if (source.present) {
        return { ...region, audioSource: structuredClone(source.value) };
    }
    const next = structuredClone(region);
    delete next.audioSource;
    return next;
}

export function matchesPresence(value: CompRegion['audioSource'], source: TempoAudioSourcePresenceSnapshot): boolean {
    if (source.present) {
        return valuesEqual(value, source.value);
    }
    return value === undefined;
}

function gapTiles(
    plan: TempoAudioSourcePromotionSnapshot,
    lane: TakeLane,
    side: 'before' | 'after'
): OptionalAudioSourceTiles | null {
    const presence = plan.gapFieldPresence.find((entry) => entry.laneId === lane.id && entry.trackId === lane.trackId);
    if (!presence) {
        return null;
    }
    if (!presence[side]) {
        return { present: false };
    }
    const value: AudioSourceTile[] = [];
    for (const gap of plan.gaps.filter((entry) => entry.laneId === lane.id && entry.trackId === lane.trackId)) {
        const source = gap[side];
        if (source.present) {
            value.push({
                clipId: gap.clipId,
                startBeat: gap.startBeat,
                endBeat: gap.endBeat,
                audioSource: structuredClone(source.value),
            });
        }
    }
    return { present: true, value };
}

/** Apply only owned source facets. Callers validate capture law and raw inputs separately.
 * All checks finish on private values before either owning store is written. */
export function projectTempoAudioSources(
    tracks: readonly Track[],
    lanes: readonly TakeLane[],
    plan: TempoAudioSourcePromotionSnapshot,
    direction: 'promote' | 'restore'
): { tracks: Track[]; lanes: TakeLane[] } | null {
    const from = direction === 'promote' ? 'before' : 'after';
    const to = direction === 'promote' ? 'after' : 'before';
    let nextTracks = [...tracks];
    for (const delta of plan.clips) {
        const track = nextTracks.find((candidate) => candidate.id === delta.trackId);
        if (!track) {
            return null;
        }
        let collection: readonly Clip[] | undefined;
        if (delta.collection === 'active') {
            if (track.activeAlternativeId !== delta.alternativeId) {
                return null;
            }
            collection = track.clips;
        } else {
            if (track.activeAlternativeId === delta.alternativeId) {
                return null;
            }
            collection = track.alternatives.find((alternative) => alternative.id === delta.alternativeId)?.clips;
        }
        const clip = collection?.find((candidate) => candidate.id === delta.clipId);
        if (
            !clip ||
            clip.type !== 'audio' ||
            clip.trackId !== delta.trackId ||
            !valuesEqual(
                {
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                    ...captureTempoSourceFields(clip, tempoClipOptionalInputs),
                },
                delta.inputs
            ) ||
            !valuesEqual(captureTempoSourceFields(clip, tempoClipSourceFields), delta[from])
        ) {
            return null;
        }
        const replacement = withClipSource(clip, delta[to]);
        let nextTrack: Track;
        if (delta.collection === 'active') {
            nextTrack = {
                ...track,
                clips: track.clips.map((candidate) => (candidate.id === clip.id ? replacement : candidate)),
            };
        } else {
            nextTrack = {
                ...track,
                alternatives: track.alternatives.map((alternative) => {
                    if (alternative.id !== delta.alternativeId) {
                        return alternative;
                    }
                    return {
                        ...alternative,
                        clips: alternative.clips.map((candidate) =>
                            candidate.id === clip.id ? replacement : candidate
                        ),
                    };
                }),
            };
        }
        nextTracks = nextTracks.map((candidate) => {
            if (candidate.id === track.id) {
                return nextTrack;
            }
            return candidate;
        });
    }
    const nextLanes = projectTempoAudioSourceLanes(lanes, plan, direction);
    if (!nextLanes) {
        return null;
    }
    return { tracks: nextTracks, lanes: nextLanes };
}

function projectTakeDelta(
    lanes: readonly TakeLane[],
    plan: TempoAudioSourcePromotionSnapshot,
    delta: TempoAudioSourcePromotionSnapshot['takes'][number],
    from: 'before' | 'after',
    to: 'before' | 'after'
): TakeLane[] | null {
    let nextLanes = [...lanes];
    const lane = nextLanes.find((candidate) => candidate.id === delta.laneId && candidate.trackId === delta.trackId);
    const take = lane?.takes.find((candidate) => candidate.id === delta.takeId && candidate.clipId === delta.clipId);
    if (
        !lane ||
        !take ||
        plan.clips.filter((clip) => clip.trackId === delta.trackId && clip.clipId === take.clipId).length !== 1 ||
        !valuesEqual(
            {
                startBeat: take.startBeat,
                endBeat: take.endBeat,
                ...captureTempoSourceFields(take, tempoTakeOptionalInputs),
            },
            delta.inputs
        ) ||
        !valuesEqual(captureTempoSourceFields(take, tempoTakeSourceFields), delta[from])
    ) {
        return null;
    }
    const replacement = withTakeSource(take, delta[to]);
    const nextLane = { ...lane, takes: lane.takes.map((row) => (row.id === take.id ? replacement : row)) };
    nextLanes = nextLanes.map((candidate) => {
        if (candidate.id === lane.id) {
            return nextLane;
        }
        return candidate;
    });

    return nextLanes;
}

function projectRegionDelta(
    lanes: readonly TakeLane[],
    plan: TempoAudioSourcePromotionSnapshot,
    delta: TempoAudioSourcePromotionSnapshot['regions'][number],
    from: 'before' | 'after',
    to: 'before' | 'after'
): TakeLane[] | null {
    let nextLanes = [...lanes];
    const lane = nextLanes.find((candidate) => candidate.id === delta.laneId && candidate.trackId === delta.trackId);
    const region = lane?.activeCompRegions.find(
        (candidate) =>
            candidate.takeId === delta.takeId &&
            candidate.startBeat === delta.startBeat &&
            candidate.endBeat === delta.endBeat
    );
    const take = lane?.takes.find((candidate) => candidate.id === delta.takeId);
    if (
        !lane ||
        !region ||
        !take ||
        take.clipId !== delta.clipId ||
        plan.clips.filter((clip) => clip.trackId === delta.trackId && clip.clipId === take.clipId).length !== 1 ||
        !matchesPresence(region.audioSource, delta[from])
    ) {
        return null;
    }
    const nextLane = {
        ...lane,
        activeCompRegions: lane.activeCompRegions.map((row) => {
            if (row === region) {
                return withRegionSource(row, delta[to]);
            }
            return row;
        }),
    };
    nextLanes = nextLanes.map((candidate) => {
        if (candidate.id === lane.id) {
            return nextLane;
        }
        return candidate;
    });

    return nextLanes;
}

function projectGapDelta(
    lanes: readonly TakeLane[],
    plan: TempoAudioSourcePromotionSnapshot,
    presence: TempoAudioSourcePromotionSnapshot['gapFieldPresence'][number],
    from: 'before' | 'after',
    to: 'before' | 'after'
): TakeLane[] | null {
    let nextLanes = [...lanes];
    const lane = nextLanes.find(
        (candidate) => candidate.id === presence.laneId && candidate.trackId === presence.trackId
    );
    if (!lane) {
        return null;
    }
    const expected = gapTiles(plan, lane, from);
    const replacement = gapTiles(plan, lane, to);
    if (!expected || !replacement) {
        return null;
    }
    const sources = reconcileBaseGapAudioSourceDelta(captureBaseGapAudioSources(lane), expected, replacement);
    if (!sources) {
        return null;
    }
    const nextLane = replaceBaseGapAudioSources(lane, sources);
    nextLanes = nextLanes.map((candidate) => {
        if (candidate.id === lane.id) {
            return nextLane;
        }
        return candidate;
    });

    return nextLanes;
}

/** The same bounded lane-facet law used by optimistic execution and raw journal replay. */
export function projectTempoAudioSourceLanes(
    lanes: readonly TakeLane[],
    plan: TempoAudioSourcePromotionSnapshot,
    direction: 'promote' | 'restore'
): TakeLane[] | null {
    const from = direction === 'promote' ? 'before' : 'after';
    const to = direction === 'promote' ? 'after' : 'before';
    let nextLanes = [...lanes];
    for (const delta of plan.takes) {
        const projected = projectTakeDelta(nextLanes, plan, delta, from, to);
        if (!projected) {
            return null;
        }
        nextLanes = projected;
    }
    for (const delta of plan.regions) {
        const projected = projectRegionDelta(nextLanes, plan, delta, from, to);
        if (!projected) {
            return null;
        }
        nextLanes = projected;
    }
    for (const presence of plan.gapFieldPresence) {
        const projected = projectGapDelta(nextLanes, plan, presence, from, to);
        if (!projected) {
            return null;
        }
        nextLanes = projected;
    }
    return nextLanes;
}
