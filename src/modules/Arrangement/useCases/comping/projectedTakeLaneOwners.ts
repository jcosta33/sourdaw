import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { takeLaneStore } from '../../stores/takeLaneStore';

import { decodeClipSplitTakeTransitions } from './decodeClipSplitTakeTransitions';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type TakeLaneOwners = { id: string; trackId: string; takes: { id: string; clipId: string }[] };

function restoreRetiredOwners(lanes: TakeLaneOwners[], captures: readonly RetiredTakeLaneSnapshot[]): void {
    for (const { lane, retiredTakeIds } of captures) {
        const restored = lane.takes.filter((take) => retiredTakeIds?.includes(take.id));
        if (restored.length === 0) {
            continue;
        }
        const target = lanes.find((live) => live.id === lane.id || live.trackId === lane.trackId);
        if (!target) {
            lanes.push({ id: lane.id, trackId: lane.trackId, takes: [...restored] });
            continue;
        }
        for (const take of restored) {
            if (!target.takes.some((live) => live.id === take.id)) {
                target.takes.push(take);
            }
        }
    }
}

function projectReKeyOwners(
    lanes: TakeLaneOwners[],
    transitions: readonly TakeReKeyLaneTransition[],
    direction: 'apply' | 'restore'
): void {
    for (const transition of transitions) {
        const lane = lanes.find((live) => live.id === transition.laneId || live.trackId === transition.trackId);
        if (!lane) {
            continue;
        }
        const from = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
        const to = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
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
        lane.takes = takes;
    }
}

function retireClipOwners(lanes: TakeLaneOwners[], clipId: string): void {
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
        const lane = lanes[index]!;
        const takes = lane.takes.filter((take) => take.clipId !== clipId);
        if (takes.length === lane.takes.length) {
            continue;
        }
        if (takes.length === 0) {
            lanes.splice(index, 1);
        } else {
            lane.takes = takes;
        }
    }
}

/** Reserve only owners produced by preceding replay members, without publishing any state. */
export function projectedTakeLaneOwners(priorActions: readonly AppAction[]): TakeLaneOwners[] {
    const lanes: TakeLaneOwners[] =
        takeLaneStore.value?.lanes.map((lane) => ({ id: lane.id, trackId: lane.trackId, takes: [...lane.takes] })) ??
        [];
    for (const action of priorActions) {
        if (action.type === 'restoreClip') {
            restoreRetiredOwners(lanes, action.payload.retiredTakeLanes ?? []);
        } else if (action.type === 'restoreClipSplitState') {
            const { replacement, rightClipId, retiredTakeLanes, reKeyedTakeLanes } = action.payload;
            const snapshotTransitions =
                replacement.takeLanes === undefined ? null : decodeClipSplitTakeTransitions(action.payload);
            if (replacement.rightClip) {
                restoreRetiredOwners(lanes, retiredTakeLanes ?? []);
                projectReKeyOwners(lanes, snapshotTransitions ?? reKeyedTakeLanes ?? [], 'apply');
            } else {
                retireClipOwners(lanes, rightClipId);
                projectReKeyOwners(
                    lanes,
                    snapshotTransitions ?? reKeyedTakeLanes ?? [],
                    snapshotTransitions ? 'apply' : 'restore'
                );
            }
        }
    }
    return lanes;
}
