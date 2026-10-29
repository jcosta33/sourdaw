import {
    type AppAction,
    type RetiredTakeLaneSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { reconcileLane } from './reconcileLane';
import { regionsOverlap } from './regionsOverlap';

type TakeLaneOwners = TakeLane;

function restoreRetiredOwners(lanes: TakeLaneOwners[], captures: readonly RetiredTakeLaneSnapshot[]): void {
    for (const { lane, retiredTakeIds } of captures) {
        const restored = lane.takes.filter((take) => retiredTakeIds?.includes(take.id));
        if (restored.length === 0) {
            continue;
        }
        const target = lanes.find((live) => live.id === lane.id || live.trackId === lane.trackId);
        if (!target) {
            const inserted = reconcileLane({ ...lane, takes: [], activeCompRegions: [] }, lane, retiredTakeIds ?? []);
            if (inserted) {
                lanes.push(inserted);
            }
            continue;
        }
        const reconciled = reconcileLane(target, lane, retiredTakeIds ?? []);
        if (reconciled) {
            target.takes = reconciled.takes;
            target.activeCompRegions = reconciled.activeCompRegions;
        }
    }
}

function projectRegions(
    live: readonly CompRegion[],
    from: readonly CompRegion[],
    to: readonly CompRegion[],
    takes: readonly Take[],
    removedTakeIds: ReadonlySet<string>
): CompRegion[] {
    const kept = live.filter(
        (region) =>
            !removedTakeIds.has(region.takeId) &&
            (!from.some((source) => valuesEqual(region, source)) || to.some((target) => valuesEqual(region, target)))
    );
    const additions = to.filter(
        (region) =>
            !from.some((source) => valuesEqual(region, source)) &&
            region.endBeat > region.startBeat &&
            takes.some((take) => take.id === region.takeId) &&
            !kept.some((current) => regionsOverlap(current, region))
    );
    return [...kept, ...additions].sort((left, right) => left.startBeat - right.startBeat);
}

function projectReKeyOwners(
    lanes: TakeLaneOwners[],
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore'
): void {
    for (const transition of transitions) {
        const lane = lanes.find((live) => live.id === transition.laneId || live.trackId === transition.trackId);
        if (!lane) {
            continue;
        }
        const from = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
        const to = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
        const fromRegions = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
        const toRegions = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;
        const fromById = new Map(from.map((take) => [take.id, take]));
        const toIds = new Set(to.map((take) => take.id));
        const liveById = new Map(lane.takes.map((take) => [take.id, take]));
        const takes: TakeLaneOwners['takes'] = [];
        for (const target of to) {
            const source = fromById.get(target.id);
            const live = liveById.get(target.id);
            // Selection belongs to the later interaction. Only the operation's
            // other facets authorize restoring a missing take from its capture.
            const modified = !source || !valuesEqual({ ...source, selected: false }, { ...target, selected: false });
            if (modified) {
                takes.push(target);
            } else if (live) {
                takes.push(live);
            }
        }
        takes.push(...lane.takes.filter((take) => !fromById.has(take.id) && !toIds.has(take.id)));
        const remainingIds = new Set(takes.map((take) => take.id));
        const removedTakeIds = new Set(lane.takes.filter((take) => !remainingIds.has(take.id)).map((take) => take.id));
        lane.activeCompRegions = projectRegions(lane.activeCompRegions, fromRegions, toRegions, takes, removedTakeIds);
        lane.takes = takes;
    }
}

function retireClipOwners(lanes: TakeLaneOwners[], clipId: string): void {
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
        const lane = lanes[index]!;
        const removedTakeIds = new Set(lane.takes.filter((take) => take.clipId === clipId).map((take) => take.id));
        const takes = lane.takes.filter((take) => take.clipId !== clipId);
        if (takes.length === lane.takes.length) {
            continue;
        }
        if (takes.length === 0) {
            lanes.splice(index, 1);
        } else {
            lane.activeCompRegions = lane.activeCompRegions.filter((region) => !removedTakeIds.has(region.takeId));
            lane.takes = takes;
        }
    }
}

/** Reserve only owners produced by preceding replay members, without publishing any state. */
export function projectedTakeLaneOwners(priorActions: readonly AppAction[]): TakeLaneOwners[] {
    const lanes: TakeLaneOwners[] =
        takeLaneStore.value?.lanes.map((lane) => ({
            ...lane,
            takes: [...lane.takes],
            activeCompRegions: [...lane.activeCompRegions],
        })) ?? [];
    for (const action of priorActions) {
        if (action.type === 'discardDuplicatedClip' || action.type === 'removeClip') {
            retireClipOwners(lanes, action.payload.clipId);
        } else if (action.type === 'restoreClip') {
            restoreRetiredOwners(lanes, action.payload.retiredTakeLanes ?? []);
        } else if (action.type === 'restoreClipSplitState') {
            const { replacement, rightClipId, retiredTakeLanes, reKeyedTakeLanes } = action.payload;
            if (replacement.rightClip) {
                restoreRetiredOwners(lanes, retiredTakeLanes ?? []);
                projectReKeyOwners(lanes, reKeyedTakeLanes ?? [], 'apply');
            } else {
                projectReKeyOwners(lanes, reKeyedTakeLanes ?? [], 'restore');
                retireClipOwners(lanes, rightClipId);
            }
        }
    }
    return lanes;
}
