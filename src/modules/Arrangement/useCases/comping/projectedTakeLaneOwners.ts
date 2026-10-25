import {
    type AppAction,
    type RetiredTakeLaneSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { replaceBaseGapAudioSources } from '../../stores/takeLaneWriteJournal';
import { preparedClipSplits } from '../clipEditing/preparedClipSplit';

import { reconcileLane } from './reconcileLane';
import { reconcileTransitionBaseGaps, reconcileTransitionRegions } from './reconcileTakeReKeySources';

type TakeLaneOwners = TakeLane;

function restoreRetiredOwners(lanes: TakeLaneOwners[], captures: readonly RetiredTakeLaneSnapshot[]): void {
    for (const { lane, retiredTakeIds, retiredBaseGapAudioSources } of captures) {
        const targetIndex = lanes.findIndex((live) => live.id === lane.id || live.trackId === lane.trackId);
        const target =
            targetIndex === -1
                ? { id: lane.id, trackId: lane.trackId, takes: [], activeCompRegions: [] }
                : lanes[targetIndex]!;
        const reconciled = reconcileLane(target, lane, retiredTakeIds ?? [], retiredBaseGapAudioSources ?? []);
        if (!reconciled) {
            continue;
        }
        if (targetIndex === -1) {
            lanes.push(reconciled);
        } else {
            lanes[targetIndex] = reconciled;
        }
    }
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
                takes.push({ ...target, selected: live?.selected ?? target.selected });
            } else if (live) {
                takes.push(live);
            }
        }
        takes.push(...lane.takes.filter((take) => !fromById.has(take.id) && !toIds.has(take.id)));
        const removedIds = new Set(
            lane.takes.filter((take) => !takes.some((next) => next.id === take.id)).map((take) => take.id)
        );
        const regionsFrom = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
        const regionsTo = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;
        const regions = reconcileTransitionRegions(lane.activeCompRegions, regionsFrom, regionsTo, takes, removedIds);
        const gaps = reconcileTransitionBaseGaps(lane, transition, direction);
        lane.takes = takes;
        lane.activeCompRegions = [...regions];
        if (gaps) {
            const replacement = replaceBaseGapAudioSources(lane, gaps);
            if (replacement.baseGapAudioSources === undefined) {
                delete lane.baseGapAudioSources;
            } else {
                lane.baseGapAudioSources = replacement.baseGapAudioSources;
            }
        }
    }
}

function retireClipOwners(lanes: TakeLaneOwners[], clipId: string): void {
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
        const lane = lanes[index]!;
        const removedTakeIds = new Set(lane.takes.filter((take) => take.clipId === clipId).map((take) => take.id));
        const takes = lane.takes.filter((take) => take.clipId !== clipId);
        const gaps = lane.baseGapAudioSources?.filter((tile) => tile.clipId !== clipId);
        if (takes.length === lane.takes.length && gaps?.length === lane.baseGapAudioSources?.length) {
            continue;
        }
        if (takes.length === 0 && !gaps?.length) {
            lanes.splice(index, 1);
        } else {
            lane.activeCompRegions = lane.activeCompRegions.filter((region) => !removedTakeIds.has(region.takeId));
            lane.takes = takes;
            const ids = new Set(takes.map((take) => take.id));
            lane.activeCompRegions = lane.activeCompRegions.filter((region) => ids.has(region.takeId));
            if (gaps !== undefined) {
                lane.baseGapAudioSources = gaps;
            }
        }
    }
}

/** Reserve only owners produced by preceding replay members, without publishing any state. */
export function projectedTakeLaneOwners(
    priorActions: readonly AppAction[],
    initial: readonly TakeLaneOwners[] = takeLaneStore.value?.lanes ?? []
): TakeLaneOwners[] {
    const lanes = initial.map((lane) => structuredClone(lane));
    for (const action of priorActions) {
        if (action.type === 'splitClip') {
            const prepared = preparedClipSplits.get(action);
            if (prepared?.takeReKeyTransitions) {
                projectReKeyOwners(lanes, prepared.takeReKeyTransitions, 'apply');
            }
        } else if (action.type === 'discardDuplicatedClip' || action.type === 'removeClip') {
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
