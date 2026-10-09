import { type ClipSplitActionSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take } from '../../models/TakeLane';
import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { validateTakeLaneTransitionPlan } from '../timeOperations/validateTakeLaneTransitionPlan';

import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type Input = {
    clipId: string;
    rightClipId: string;
    expected: ClipSplitActionSnapshot;
    replacement: ClipSplitActionSnapshot;
};
type LaneSnapshot = NonNullable<ReturnType<typeof decodeExactTakeLaneSnapshots>>[number];

function decodeFacets(value: unknown) {
    if (!isRecord(value) || value.version !== 1 || Object.keys(value).length !== 2 || !Array.isArray(value.lanes)) {
        return null;
    }
    const lanes = decodeExactTakeLaneSnapshots(value.lanes);
    if (!lanes || new Set(lanes.map((lane) => lane.id)).size !== lanes.length) {
        return null;
    }
    const ids = lanes.flatMap((lane) => lane.takes.map((take) => take.id));
    return new Set(ids).size === ids.length ? lanes : null;
}

function expectedSplitTakes(takes: readonly Take[], after: readonly Take[], seam: number, rightClipId: string) {
    const expected: Take[] = [];
    const rightIds = new Map<string, string>();
    for (const take of takes) {
        if (take.endBeat <= seam) {
            expected.push(take);
            continue;
        }
        if (take.startBeat < seam) {
            expected.push({ ...take, endBeat: seam });
        }
        const id = `${take.id}:split-right:${rightClipId}`;
        const right = after.find((candidate) => candidate.id === id);
        if (
            !right ||
            right.sourceOffsetBeats !== take.sourceOffsetBeats ||
            (take.sourceOffsetSeconds !== undefined && right.sourceOffsetSeconds !== take.sourceOffsetSeconds) ||
            (take.sourceOffsetBeats !== undefined &&
                take.passAnchorSeconds === undefined &&
                right.sourceOffsetSeconds === undefined)
        ) {
            return null;
        }
        const expectedRight: Take = {
            ...take,
            id,
            clipId: rightClipId,
            startBeat: Math.max(take.startBeat, seam),
            selected: take.selected && take.startBeat >= seam,
        };
        if (right.sourceOffsetSeconds !== undefined) {
            expectedRight.sourceOffsetSeconds = right.sourceOffsetSeconds;
        }
        expected.push(expectedRight);
        rightIds.set(take.id, id);
    }
    return { takes: expected, rightIds };
}

function expectedSplitRegions(regions: readonly CompRegion[], rightIds: ReadonlyMap<string, string>, seam: number) {
    const expected: CompRegion[] = [];
    for (const region of regions) {
        if (region.startBeat < seam) {
            expected.push({ ...region, endBeat: Math.min(region.endBeat, seam) });
        }
        if (region.endBeat > seam) {
            const takeId = rightIds.get(region.takeId);
            if (!takeId) {
                return null;
            }
            expected.push({ ...region, takeId, startBeat: Math.max(region.startBeat, seam) });
        }
    }
    return expected;
}

function matchesLanePartition(
    lane: LaneSnapshot,
    after: LaneSnapshot | undefined,
    trackId: string,
    clipId: string,
    rightClipId: string,
    seam: number
): boolean {
    if (
        !after ||
        lane.trackId !== trackId ||
        after.trackId !== lane.trackId ||
        lane.takes.some((take) => take.clipId !== clipId)
    ) {
        return false;
    }
    const takes = expectedSplitTakes(lane.takes, after.takes, seam, rightClipId);
    if (!takes || !valuesEqual(takes.takes, after.takes)) {
        return false;
    }
    const regions = expectedSplitRegions(lane.activeCompRegions, takes.rightIds, seam);
    return regions !== null && valuesEqual(regions, after.activeCompRegions);
}

/** Historical absent pairs stay readable; new pairs must describe only this exact split's facets. */
export function decodeClipSplitTakeTransitions(input: Input): readonly TakeReKeyLaneTransition[] | null {
    const { expected, replacement, clipId, rightClipId } = input;
    if (expected.takeLanes === undefined && replacement.takeLanes === undefined) {
        return [];
    }
    const from = decodeFacets(expected.takeLanes);
    const to = decodeFacets(replacement.takeLanes);
    if (!from || !to || from.length !== to.length || expected.trackId !== replacement.trackId) {
        return null;
    }
    const before = expected.rightClip === null ? expected : replacement;
    const split = expected.rightClip === null ? replacement : expected;
    if (before.rightClip !== null || !split.rightClip || (before.leftClip.type !== 'audio' && from.length > 0)) {
        return null;
    }
    const seam = split.rightClip.startBeat;
    if (split.leftClip.endBeat !== seam) {
        return null;
    }
    const beforeLanes = expected.rightClip === null ? from : to;
    const afterLanes = expected.rightClip === null ? to : from;
    for (const lane of beforeLanes) {
        const after = afterLanes.find((candidate) => candidate.id === lane.id);
        if (!matchesLanePartition(lane, after, before.trackId, clipId, rightClipId, seam)) {
            return null;
        }
    }
    const transitions = from.map((lane) => {
        const target = to.find((candidate) => candidate.id === lane.id)!;
        return {
            laneId: lane.id,
            trackId: lane.trackId,
            takesBefore: lane.takes,
            takesAfter: target.takes,
            regionsBefore: lane.activeCompRegions,
            regionsAfter: target.activeCompRegions,
        };
    });
    return (
        validateTakeLaneTransitionPlan({
            version: 1,
            appliedEffect: 'retire',
            removedClipIds: [],
            retiredLanes: [],
            reKeyedLanes: transitions,
        })?.reKeyedLanes ?? null
    );
}
