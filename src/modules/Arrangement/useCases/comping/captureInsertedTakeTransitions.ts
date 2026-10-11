import { readTempoAtBeat } from '#/modules/Transport/stores';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { materializeTakeSourceDepth } from './materializeTakeSourceDepth';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type ClipGeometry = { id: string; startBeat: number; endBeat: number; type: 'audio' | 'midi' };
type Owner = { id: string; clips: readonly { source: ClipGeometry }[] };
type AfterTrack = { id: string; clips: readonly ClipGeometry[] };

type InsertedTakeCapture = {
    owners: readonly Owner[];
    afterTracks: readonly AfterTrack[];
    atBeat: number;
    durationBeats: number;
    copyTargets?: ReadonlyMap<string, string>;
    rightTargets?: ReadonlyMap<string, string>;
};

/** Keep source depth at the original clip's tempo, even when its new beat lands past a marker. */
function movedTake(take: Take, clip: ClipGeometry, atBeat: number, durationBeats: number): Take {
    if (clip.type !== 'audio' || clip.startBeat < atBeat) {
        return take;
    }
    const source = materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat }));
    return {
        ...source,
        startBeat: take.startBeat + durationBeats,
        endBeat: take.endBeat + durationBeats,
    };
}

function movedRegion(
    region: CompRegion,
    clip: ClipGeometry | undefined,
    atBeat: number,
    durationBeats: number
): CompRegion {
    if (!clip || clip.type !== 'audio' || clip.startBeat < atBeat) {
        return region;
    }
    return {
        ...region,
        startBeat: region.startBeat + durationBeats,
        endBeat: region.endBeat + durationBeats,
    };
}

function copiedRegionsForTake(
    regions: readonly CompRegion[],
    takeId: string,
    copyId: string,
    clip: ClipGeometry,
    displacement: number
): CompRegion[] {
    return regions.flatMap((region) => {
        if (region.takeId !== takeId) {
            return [];
        }
        const startBeat = Math.max(region.startBeat, clip.startBeat);
        const endBeat = Math.min(region.endBeat, clip.endBeat);
        if (startBeat >= endBeat) {
            return [];
        }
        return [{ startBeat: startBeat + displacement, endBeat: endBeat + displacement, takeId: copyId }];
    });
}

function splitTakeAtInsert(
    take: Take,
    clip: ClipGeometry,
    rightClipId: string,
    input: InsertedTakeCapture,
    usedTakeIds: Set<string>,
    rightTakeIds: Map<string, string>
): Take[] | null {
    const fragments: Take[] = [];
    if (take.startBeat < input.atBeat) {
        fragments.push({ ...take, endBeat: Math.min(take.endBeat, input.atBeat) });
    }
    if (take.endBeat <= input.atBeat) {
        return fragments;
    }
    const rightTakeId = `${take.id}:time-insert-right:${rightClipId}`;
    if (usedTakeIds.has(rightTakeId)) {
        return null;
    }
    usedTakeIds.add(rightTakeId);
    rightTakeIds.set(take.id, rightTakeId);
    fragments.push({
        ...materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat })),
        id: rightTakeId,
        clipId: rightClipId,
        startBeat: Math.max(take.startBeat, input.atBeat) + input.durationBeats,
        endBeat: take.endBeat + input.durationBeats,
    });
    return fragments;
}

function splitRegionAtInsert(
    region: CompRegion,
    input: InsertedTakeCapture,
    rightTakeIds: ReadonlyMap<string, string>
): CompRegion[] | null {
    const fragments: CompRegion[] = [];
    if (region.startBeat < input.atBeat) {
        fragments.push({ ...region, endBeat: Math.min(region.endBeat, input.atBeat) });
    }
    if (region.endBeat <= input.atBeat) {
        return fragments;
    }
    const rightTakeId = rightTakeIds.get(region.takeId);
    if (!rightTakeId) {
        return null;
    }
    fragments.push({
        ...region,
        startBeat: Math.max(region.startBeat, input.atBeat) + input.durationBeats,
        endBeat: region.endBeat + input.durationBeats,
        takeId: rightTakeId,
    });
    return fragments;
}

function appendCopiedTakes(
    lane: TakeLane,
    beforeClips: ReadonlyMap<string, ClipGeometry>,
    afterClips: ReadonlyMap<string, ClipGeometry>,
    copyTargets: ReadonlyMap<string, string> | undefined,
    usedTakeIds: Set<string>,
    takesAfter: Take[],
    regionsAfter: CompRegion[]
): boolean | null {
    if (!copyTargets) {
        return false;
    }
    let copied = false;
    for (const take of lane.takes) {
        const clip = beforeClips.get(take.clipId);
        const targetId = copyTargets.get(take.clipId);
        const target = targetId ? afterClips.get(targetId) : undefined;
        if (!clip || clip.type !== 'audio' || !target) {
            continue;
        }
        const copyId = `${take.id}:time-duplicate:${target.id}`;
        if (usedTakeIds.has(copyId)) {
            return null;
        }
        usedTakeIds.add(copyId);
        copied = true;
        const depth = materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat }));
        const displacement = target.startBeat - clip.startBeat;
        takesAfter.push({
            ...depth,
            id: copyId,
            clipId: target.id,
            startBeat: take.startBeat + displacement,
            endBeat: take.endBeat + displacement,
        });
        regionsAfter.push(...copiedRegionsForTake(lane.activeCompRegions, take.id, copyId, clip, displacement));
    }
    return copied;
}

function captureInsertedRegions(
    lane: TakeLane,
    takeById: ReadonlyMap<string, Take>,
    beforeClips: ReadonlyMap<string, ClipGeometry>,
    input: InsertedTakeCapture,
    rightTakeIds: ReadonlyMap<string, string>
): { regions: CompRegion[]; changed: boolean } | null {
    const regions: CompRegion[] = [];
    let changed = false;
    for (const region of lane.activeCompRegions) {
        const take = takeById.get(region.takeId);
        const clip = take ? beforeClips.get(take.clipId) : undefined;
        const rightClipId = clip ? input.rightTargets?.get(clip.id) : undefined;
        if (rightClipId !== undefined && clip?.type === 'audio') {
            const fragments = splitRegionAtInsert(region, input, rightTakeIds);
            if (fragments === null) {
                return null;
            }
            regions.push(...fragments);
            continue;
        }
        const moved = movedRegion(region, clip, input.atBeat, input.durationBeats);
        changed ||= moved !== region;
        regions.push(moved);
    }
    return { regions, changed };
}

function captureLaneInsertion(
    lane: TakeLane,
    beforeClips: ReadonlyMap<string, ClipGeometry>,
    afterClips: ReadonlyMap<string, ClipGeometry>,
    input: InsertedTakeCapture
): TakeReKeyLaneTransition | null | undefined {
    const takeById = new Map(lane.takes.map((take) => [take.id, take]));
    const rightTakeIds = new Map<string, string>();
    const usedTakeIds = new Set(lane.takes.map((take) => take.id));
    let changed = false;
    const takesAfter: Take[] = [];
    for (const take of lane.takes) {
        const clip = beforeClips.get(take.clipId);
        if (!clip || !afterClips.has(clip.id)) {
            takesAfter.push(take);
            continue;
        }
        const rightClipId = input.rightTargets?.get(clip.id);
        if (rightClipId !== undefined && clip.type === 'audio') {
            const fragments = splitTakeAtInsert(take, clip, rightClipId, input, usedTakeIds, rightTakeIds);
            if (fragments === null) {
                return null;
            }
            changed = true;
            takesAfter.push(...fragments);
            continue;
        }
        const moved = movedTake(take, clip, input.atBeat, input.durationBeats);
        changed ||= moved !== take;
        takesAfter.push(moved);
    }
    const capturedRegions = captureInsertedRegions(lane, takeById, beforeClips, input, rightTakeIds);
    if (capturedRegions === null) {
        return null;
    }
    const regionsAfter = capturedRegions.regions;
    changed ||= capturedRegions.changed;

    const copied = appendCopiedTakes(
        lane,
        beforeClips,
        afterClips,
        input.copyTargets,
        usedTakeIds,
        takesAfter,
        regionsAfter
    );
    if (copied === null) {
        return null;
    }
    changed ||= copied;
    if (!changed) {
        return undefined;
    }
    regionsAfter.sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat);
    return {
        laneId: lane.id,
        trackId: lane.trackId,
        takesBefore: lane.takes,
        takesAfter,
        regionsBefore: lane.activeCompRegions,
        regionsAfter,
    };
}

/** Capture the insert leg of insert/duplicate time, including a duplicate's new take and comp. */
export function captureInsertedTakeTransitions(input: InsertedTakeCapture): readonly TakeReKeyLaneTransition[] | null {
    const state = takeLaneStore.value;
    if (!state) {
        return [];
    }
    const beforeByTrack = new Map(
        input.owners.map((owner) => [owner.id, new Map(owner.clips.map(({ source }) => [source.id, source]))] as const)
    );
    const afterByTrack = new Map(
        input.afterTracks.map((track) => [track.id, new Map(track.clips.map((clip) => [clip.id, clip]))] as const)
    );
    const transitions: TakeReKeyLaneTransition[] = [];
    for (const lane of state.lanes) {
        const beforeClips = beforeByTrack.get(lane.trackId);
        const afterClips = afterByTrack.get(lane.trackId);
        if (!beforeClips || !afterClips) {
            continue;
        }
        const transition = captureLaneInsertion(lane, beforeClips, afterClips, input);
        if (transition === null) {
            return null;
        }
        if (transition !== undefined) {
            transitions.push(transition);
        }
    }
    return transitions;
}
