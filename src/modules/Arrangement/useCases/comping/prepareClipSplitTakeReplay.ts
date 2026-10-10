import { type ClipSplitActionSnapshot, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { decodeClipSplitTakeTransitions } from './decodeClipSplitTakeTransitions';
import { regionsOverlap } from './regionsOverlap';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type Input = {
    clipId: string;
    rightClipId: string;
    expected: ClipSplitActionSnapshot;
    replacement: ClipSplitActionSnapshot;
    retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
};

function ownedFields(take: Take) {
    return {
        id: take.id,
        clipId: take.clipId,
        startBeat: take.startBeat,
        endBeat: take.endBeat,
        sourceOffsetBeats: take.sourceOffsetBeats,
        sourceOffsetSeconds: take.sourceOffsetSeconds,
        passAnchorSeconds: take.passAnchorSeconds,
        passDepthSeconds: take.passDepthSeconds,
    };
}

function retiredTakeMatches(take: Take, trackId: string, lanes: readonly TakeLane[]): boolean {
    const resident = lanes.find((lane) => lane.takes.some((candidate) => candidate.id === take.id));
    if (resident && resident.trackId !== trackId) {
        return false;
    }
    const live = resident?.takes.find((candidate) => candidate.id === take.id);
    return !live || valuesEqual(ownedFields(live), ownedFields(take));
}

function retiredCaptureMatches(
    input: Input,
    capture: RetiredTakeLaneSnapshot,
    transitions: readonly TakeReKeyLaneTransition[],
    lanes: readonly TakeLane[]
): boolean {
    if (capture.lane.trackId !== input.replacement.trackId) {
        return false;
    }
    const retiredIds = new Set(capture.retiredTakeIds ?? []);
    const retiredTakes = capture.lane.takes.filter((take) => retiredIds.has(take.id));
    if (retiredTakes.some((take) => take.clipId !== input.rightClipId)) {
        return false;
    }
    for (const take of retiredTakes) {
        if (!retiredTakeMatches(take, capture.lane.trackId, lanes)) {
            return false;
        }
    }
    const live = lanes.find((lane) => lane.id === capture.lane.id || lane.trackId === capture.lane.trackId);
    const transition = transitions.find((candidate) => candidate.trackId === capture.lane.trackId);
    const removed =
        transition?.regionsBefore.filter(
            (region) => !transition.regionsAfter.some((target) => valuesEqual(region, target))
        ) ?? [];
    const kept =
        live?.activeCompRegions.filter((region) => !removed.some((source) => valuesEqual(region, source))) ?? [];
    const restoring = capture.lane.activeCompRegions.filter((region) => retiredIds.has(region.takeId));
    return !restoring.some((region) =>
        kept.some((current) => regionsOverlap(region, current) && !valuesEqual(region, current))
    );
}

function retiredCapturesMatch(
    input: Input,
    transitions: readonly TakeReKeyLaneTransition[],
    lanes: readonly TakeLane[]
): boolean {
    if (!input.replacement.rightClip) {
        return true;
    }
    for (const capture of input.retiredTakeLanes ?? []) {
        if (!retiredCaptureMatches(input, capture, transitions, lanes)) {
            return false;
        }
    }
    return true;
}

function prepareLaneTransition(
    transition: TakeReKeyLaneTransition,
    lanes: readonly TakeLane[]
): TakeReKeyLaneTransition | null {
    const live = lanes.find((lane) => lane.id === transition.laneId && lane.trackId === transition.trackId);
    if (!live) {
        return null;
    }
    const fromIds = new Set(transition.takesBefore.map((take) => take.id));
    for (const source of transition.takesBefore) {
        const current = live.takes.find((take) => take.id === source.id);
        if (!current || !valuesEqual(ownedFields(current), ownedFields(source))) {
            return null;
        }
    }
    for (const target of transition.takesAfter) {
        if (!fromIds.has(target.id) && lanes.some((lane) => lane.takes.some((take) => take.id === target.id))) {
            return null;
        }
    }
    const removed = transition.regionsBefore.filter(
        (region) => !transition.regionsAfter.some((target) => valuesEqual(region, target))
    );
    if (removed.some((region) => !live.activeCompRegions.some((current) => valuesEqual(region, current)))) {
        return null;
    }
    const kept = live.activeCompRegions.filter((region) => !removed.some((source) => valuesEqual(region, source)));
    const added = transition.regionsAfter.filter(
        (region) => !transition.regionsBefore.some((source) => valuesEqual(region, source))
    );
    if (added.some((region) => kept.some((current) => regionsOverlap(region, current)))) {
        return null;
    }
    const metadata = (take: Take): Take => {
        const current = live.takes.find((candidate) => candidate.id === take.id);
        return current ? { ...take, name: current.name, selected: current.selected } : take;
    };
    return {
        ...transition,
        takesBefore: transition.takesBefore.map(metadata),
        takesAfter: transition.takesAfter.map(metadata),
    };
}

/** Refuse incomplete split replay before any owner writes; preserve live interaction and naming fields. */
export function prepareClipSplitTakeReplay(input: Input): readonly TakeReKeyLaneTransition[] | null {
    const transitions = decodeClipSplitTakeTransitions(input);
    if (!transitions) {
        return null;
    }
    const lanes = takeLaneStore.value?.lanes ?? [];
    if (!retiredCapturesMatch(input, transitions, lanes)) {
        return null;
    }
    if (input.expected.takeLanes === undefined) {
        return transitions;
    }
    const knownIds = new Set(transitions.flatMap((transition) => transition.takesBefore.map((take) => take.id)));
    if (
        input.expected.leftClip.type === 'audio' &&
        input.replacement.rightClip &&
        lanes.some(
            (lane) =>
                lane.trackId === input.expected.trackId &&
                lane.takes.some(
                    (take) =>
                        take.clipId === input.clipId &&
                        !knownIds.has(take.id) &&
                        take.endBeat > input.replacement.rightClip!.startBeat
                )
        )
    ) {
        return null;
    }
    const prepared: TakeReKeyLaneTransition[] = [];
    for (const transition of transitions) {
        const lane = prepareLaneTransition(transition, lanes);
        if (!lane) {
            return null;
        }
        prepared.push(lane);
    }
    return prepared;
}
