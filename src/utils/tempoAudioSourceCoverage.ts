import {
    hasValidAudioPassOrigin,
    hasValidAudioSourceState,
    hasValidAudioSourceTiles,
    isAudioSourceSnapshot,
    isAudioSourceTile,
    partitionAudioSourceTiles,
} from './audioSourceTime';
import { compBaseGapWindows } from './compBaseGapWindows';
import { type TempoAudioSourcePromotionSnapshot } from './handlerContract';
import { isRecord, valuesEqual } from './structuralEquality';

type ClipValue = Record<string, unknown> & { id: string; trackId: string; startBeat: number; endBeat: number };
type Owner = {
    trackId: string;
    collection: 'active' | 'alternative';
    alternativeId: string;
    clipId: string;
    clip: ClipValue;
};
type TakeNeed = Owner & {
    laneId: string;
    takeId: string;
    take: Record<string, unknown>;
    depth: boolean;
    origin: boolean;
};
type RegionNeed = Owner & { laneId: string; takeId: string; startBeat: number; endBeat: number };
type GapNeed = Owner & { laneId: string; startBeat: number; endBeat: number };
type Requirements = { clips: Owner[]; takes: TakeNeed[]; regions: RegionNeed[]; gaps: GapNeed[] };

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function identity(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
function ranged(value: unknown): value is Record<string, unknown> & { startBeat: number; endBeat: number } {
    return (
        isRecord(value) &&
        finite(value.startBeat) &&
        finite(value.endBeat) &&
        value.startBeat >= 0 &&
        value.endBeat >= value.startBeat
    );
}
function ownerKey(owner: Owner): string {
    return JSON.stringify([owner.trackId, owner.collection, owner.alternativeId, owner.clipId]);
}
function pick(value: Record<string, unknown>, keys: readonly string[]) {
    return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

/** One clock-free classifier serves the producer and raw read-set guard.
 * It names required captures, never calculates a source time or supplies history. */
export function getTempoAudioSourceRequirements(document: Readonly<Record<string, unknown>>): Requirements | null {
    if (
        (document.tracks !== undefined && !isRecord(document.tracks)) ||
        (document.takeLanes !== undefined && !isRecord(document.takeLanes))
    ) {
        return null;
    }
    const rawTracks = isRecord(document.tracks) ? document.tracks.tracks : [];
    const rawLanes = isRecord(document.takeLanes) ? document.takeLanes.lanes : [];
    if (!Array.isArray(rawTracks) || !Array.isArray(rawLanes)) {
        return null;
    }
    const result: Requirements = { clips: [], takes: [], regions: [], gaps: [] };
    const required = new Map<string, Owner>();
    const owners: Owner[] = [];
    const keys = new Set<string>();
    for (const track of rawTracks) {
        if (
            !isRecord(track) ||
            !identity(track.id) ||
            !Array.isArray(track.clips) ||
            !Array.isArray(track.alternatives)
        ) {
            return null;
        }
        const collections = [
            { collection: 'active' as const, alternativeId: track.activeAlternativeId, clips: track.clips },
        ];
        const inactive: { collection: 'alternative'; alternativeId: unknown; clips: unknown[] }[] = [];
        for (const alternative of track.alternatives) {
            if (!isRecord(alternative) || !identity(alternative.id) || !Array.isArray(alternative.clips)) {
                return null;
            }
            if (alternative.id !== track.activeAlternativeId) {
                inactive.push({ collection: 'alternative', alternativeId: alternative.id, clips: alternative.clips });
            }
        }
        for (const collection of [...collections, ...inactive]) {
            for (const clip of collection.clips) {
                if (!isRecord(clip)) {
                    return null;
                }
                if (clip.type !== 'audio') {
                    continue;
                }
                if (
                    !identity(collection.alternativeId) ||
                    !identity(clip.id) ||
                    clip.trackId !== track.id ||
                    !ranged(clip) ||
                    !hasValidAudioSourceState(clip) ||
                    ['audioOffsetBeats', 'loopLength', 'loopOriginBeat', 'stretchRatio'].some(
                        (field) => clip[field] !== undefined && !finite(clip[field])
                    ) ||
                    (clip.loopEnabled !== undefined && typeof clip.loopEnabled !== 'boolean') ||
                    ['audioBufferId', 'assetHash'].some(
                        (field) => clip[field] !== undefined && typeof clip[field] !== 'string'
                    )
                ) {
                    return null;
                }
                const value: ClipValue = {
                    ...clip,
                    id: clip.id,
                    trackId: track.id,
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                };
                const owner: Owner = {
                    trackId: track.id,
                    collection: collection.collection,
                    alternativeId: collection.alternativeId,
                    clipId: clip.id,
                    clip: value,
                };
                const key = ownerKey(owner);
                if (keys.has(key)) {
                    return null;
                }
                keys.add(key);
                owners.push(owner);
                if (
                    clip.audioOffsetSeconds === undefined ||
                    clip.audioUnwrappedOffsetSeconds === undefined ||
                    (clip.loopEnabled &&
                        ['audioLoopStartSeconds', 'audioLoopPassEntrySeconds', 'audioLoopPassOriginBeat'].some(
                            (field) => clip[field] === undefined
                        ))
                ) {
                    required.set(key, owner);
                }
            }
        }
    }
    const laneIds = new Set<string>();
    for (const lane of rawLanes) {
        if (
            !isRecord(lane) ||
            !identity(lane.id) ||
            !identity(lane.trackId) ||
            !Array.isArray(lane.takes) ||
            !Array.isArray(lane.activeCompRegions) ||
            laneIds.has(lane.id)
        ) {
            return null;
        }
        laneIds.add(lane.id);
        const laneOwners = owners.filter((owner) => owner.trackId === lane.trackId);
        const takeOwners = new Map<string, Owner>();
        const takes = new Map<string, Record<string, unknown>>();
        for (const take of lane.takes) {
            if (!isRecord(take) || !identity(take.id) || !identity(take.clipId) || takes.has(take.id)) {
                return null;
            }
            takes.set(take.id, take);
            const matches = laneOwners.filter((owner) => owner.clipId === take.clipId);
            if (matches.length > 1) {
                return null;
            }
            const owner = matches[0];
            if (!owner) {
                continue;
            }
            if (
                !ranged(take) ||
                !hasValidAudioPassOrigin(take) ||
                ['sourceOffsetBeats', 'sourceOffsetSeconds', 'passDepthSeconds'].some((field) => {
                    const value = take[field];
                    return value !== undefined && (!finite(value) || value < 0);
                }) ||
                ['passAnchorSeconds', 'passSourceEndSeconds'].some(
                    (field) => take[field] !== undefined && !finite(take[field])
                ) ||
                (take.passAnchorSeconds === undefined) !== (take.passDepthSeconds === undefined) ||
                (take.passAnchorSeconds !== undefined && take.sourceOffsetBeats === undefined) ||
                (take.passSourceEndSeconds !== undefined &&
                    (!finite(take.passSourceEndSeconds) ||
                        !finite(take.passDepthSeconds) ||
                        take.passSourceEndSeconds <= take.passDepthSeconds))
            ) {
                return null;
            }
            takeOwners.set(take.id, owner);
            const depth = take.sourceOffsetBeats !== undefined && take.sourceOffsetSeconds === undefined;
            const origin = take.passAnchorSeconds !== undefined && take.passOriginBeat === undefined;
            if (depth || origin) {
                required.set(ownerKey(owner), owner);
                result.takes.push({ ...owner, laneId: lane.id, takeId: take.id, take, depth, origin });
            }
        }
        const regions: { startBeat: number; endBeat: number }[] = [];
        let previous = -Infinity;
        for (const region of lane.activeCompRegions) {
            if (
                !ranged(region) ||
                !identity(region.takeId) ||
                region.startBeat < previous ||
                (region.audioSource !== undefined && !isAudioSourceSnapshot(region.audioSource))
            ) {
                return null;
            }
            previous = region.endBeat;
            regions.push({ startBeat: region.startBeat, endBeat: region.endBeat });
            const owner = takeOwners.get(region.takeId);
            const take = takes.get(region.takeId);
            if (
                !owner ||
                !take ||
                take.passAnchorSeconds !== undefined ||
                region.audioSource !== undefined ||
                Math.max(region.startBeat, owner.clip.startBeat) >= Math.min(region.endBeat, owner.clip.endBeat)
            ) {
                continue;
            }
            required.set(ownerKey(owner), owner);
            result.regions.push({
                ...owner,
                laneId: lane.id,
                takeId: region.takeId,
                startBeat: region.startBeat,
                endBeat: region.endBeat,
            });
        }
        const tiles = lane.baseGapAudioSources ?? [];
        if (!Array.isArray(tiles) || !tiles.every(isAudioSourceTile) || !hasValidAudioSourceTiles(tiles)) {
            return null;
        }
        if (regions.length === 0 && tiles.length === 0) {
            continue;
        }
        for (const owner of laneOwners) {
            for (const gap of compBaseGapWindows(owner.clip, regions)) {
                for (const window of partitionAudioSourceTiles(owner.clipId, gap.startBeat, gap.endBeat, tiles)) {
                    if (!window.audioSource) {
                        required.set(ownerKey(owner), owner);
                        result.gaps.push({
                            ...owner,
                            laneId: lane.id,
                            startBeat: window.startBeat,
                            endBeat: window.endBeat,
                        });
                    }
                }
            }
        }
    }
    result.clips = [...required.values()];
    return result;
}

const clipFields = [
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
];
const clipInputs = [
    'startBeat',
    'endBeat',
    'audioBufferId',
    'assetHash',
    'audioOffsetBeats',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
];
const takeFields = ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds'];
const takeInputs = [
    'startBeat',
    'endBeat',
    'sourceOffsetBeats',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
];

/** Completeness is a read-set guard. Existing per-owner guards authorize writes. */
export function tempoAudioSourceCoverageMatches(
    document: Readonly<Record<string, unknown>>,
    promotion?: TempoAudioSourcePromotionSnapshot
): boolean {
    const needed = getTempoAudioSourceRequirements(document);
    if (!needed) {
        return false;
    }
    if (!promotion) {
        return needed.clips.length + needed.takes.length + needed.regions.length + needed.gaps.length === 0;
    }
    return (
        needed.clips.every((owner) =>
            promotion.clips.some(
                (delta) =>
                    ownerKey(owner) ===
                        JSON.stringify([delta.trackId, delta.collection, delta.alternativeId, delta.clipId]) &&
                    valuesEqual(pick(owner.clip, clipInputs), delta.inputs) &&
                    (valuesEqual(pick(owner.clip, clipFields), delta.before) ||
                        valuesEqual(pick(owner.clip, clipFields), delta.after))
            )
        ) &&
        needed.takes.every((owner) =>
            promotion.takes.some(
                (delta) =>
                    delta.trackId === owner.trackId &&
                    delta.laneId === owner.laneId &&
                    delta.takeId === owner.takeId &&
                    delta.clipId === owner.clipId &&
                    valuesEqual(pick(owner.take, takeInputs), delta.inputs) &&
                    (valuesEqual(pick(owner.take, takeFields), delta.before) ||
                        valuesEqual(pick(owner.take, takeFields), delta.after))
            )
        ) &&
        needed.regions.every((owner) =>
            promotion.regions.some(
                (delta) =>
                    delta.trackId === owner.trackId &&
                    delta.laneId === owner.laneId &&
                    delta.takeId === owner.takeId &&
                    delta.clipId === owner.clipId &&
                    delta.startBeat === owner.startBeat &&
                    delta.endBeat === owner.endBeat
            )
        ) &&
        needed.gaps.every((owner) =>
            promotion.gaps.some(
                (delta) =>
                    delta.trackId === owner.trackId &&
                    delta.laneId === owner.laneId &&
                    delta.clipId === owner.clipId &&
                    delta.startBeat === owner.startBeat &&
                    delta.endBeat === owner.endBeat
            )
        )
    );
}
