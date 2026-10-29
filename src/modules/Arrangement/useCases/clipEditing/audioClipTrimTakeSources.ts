import { type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { captureCompRegionSourceOperations, replayTakeLaneWriteJournal } from '../../stores/takeLaneWriteJournal';
import { type OptionalNumberValue, type TakeLaneWriteOperation } from '../../stores/takeLaneWriteTypes';
import { captureResolvedAudioSourceSnapshot } from '../comping/captureResolvedAudioSourceSnapshot';
import { resolveCompingProgramme } from '../comping/resolveCompingProgramme';
import { captureTakeSource } from '../comping/captureTakeSource';
import { isReKeyLaneTransition } from '../timeOperations/isReKeyLaneTransition';

const writtenFields = ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds'] as const;
const inputFields = [
    'id',
    'clipId',
    'startBeat',
    'endBeat',
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
] as const;

/** Selection, names and order belong to the live lane, not this source-only edit. */
export function audioClipTrimTakeInputs(take: Take): Record<string, unknown> {
    return Object.fromEntries(inputFields.filter((key) => Object.hasOwn(take, key)).map((key) => [key, take[key]]));
}

function capturedRegions(clip: Clip, lane: TakeLane, timeline: TempoTimeline): CompRegion[] {
    // Resolve the current programme before take promotion changes reader admission.
    // A later comp selection owns its new programme through the ordinary comp writer.
    const programme = resolveCompingProgramme(lane.trackId, [clip], { lanes: [lane] }, timeline);
    return lane.activeCompRegions.map((region) => {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId);
        if (region.audioSource !== undefined || !take || take.passAnchorSeconds !== undefined) {
            return structuredClone(region);
        }
        const fragment = programme.find(
            (part) => part.id === clip.id && part.startBeat >= region.startBeat && part.endBeat <= region.endBeat
        );
        const source = fragment && captureResolvedAudioSourceSnapshot(fragment, timeline);
        return source ? { ...region, audioSource: source } : structuredClone(region);
    });
}

export function captureAudioClipTrimTakeSources(
    clip: Clip,
    lanes: readonly TakeLane[],
    timeline: TempoTimeline
): TakeReKeyLaneTransitionSnapshot[] {
    return lanes
        .filter((lane) => lane.takes.some((take) => take.clipId === clip.id))
        .map((lane) => {
            const takesBefore = lane.takes.filter((take) => take.clipId === clip.id);
            const takeIds = new Set(takesBefore.map((take) => take.id));
            const regionsBefore = lane.activeCompRegions.filter((region) => takeIds.has(region.takeId));
            const regionsAfter = capturedRegions(
                clip,
                { ...lane, takes: takesBefore, activeCompRegions: regionsBefore },
                timeline
            );
            return {
                laneId: lane.id,
                trackId: lane.trackId,
                takesBefore: structuredClone(takesBefore),
                takesAfter: takesBefore.map((take) => structuredClone(captureTakeSource(take, clip, timeline))),
                regionsBefore: structuredClone(regionsBefore),
                regionsAfter,
            };
        });
}

/** The existing transition codec plus the exact source-only before-edit law. */
export function isAudioClipTrimTakeSources(
    value: unknown,
    clip: Clip,
    timeline: TempoTimeline
): value is TakeReKeyLaneTransitionSnapshot[] {
    if (!Array.isArray(value) || !value.every(isReKeyLaneTransition)) {
        return false;
    }
    const laneIds = new Set<string>();
    const takeIds = new Set<string>();
    for (const transition of value) {
        if (
            laneIds.has(transition.laneId) ||
            transition.trackId !== clip.trackId ||
            transition.takesBefore.length === 0 ||
            Object.hasOwn(transition, 'baseGapAudioSourcesBefore') ||
            Object.hasOwn(transition, 'baseGapAudioSourcesAfter')
        ) {
            return false;
        }
        laneIds.add(transition.laneId);
        for (const take of transition.takesBefore) {
            if (take.clipId !== clip.id || takeIds.has(take.id)) {
                return false;
            }
            takeIds.add(take.id);
        }
        if (
            !valuesEqual(
                transition.takesAfter,
                transition.takesBefore.map((take) => captureTakeSource(take, clip, timeline))
            )
        ) {
            return false;
        }
        const lane: TakeLane = {
            id: transition.laneId,
            trackId: transition.trackId,
            takes: [...transition.takesBefore],
            activeCompRegions: [...transition.regionsBefore],
        };
        if (!valuesEqual(transition.regionsAfter, capturedRegions(clip, lane, timeline))) {
            return false;
        }
    }
    return true;
}

/** Authenticate every derivation input and complete target membership, including unchanged takes. */
export function audioClipTrimTakeSourcesMatch(
    lanes: readonly TakeLane[],
    clipId: string,
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore'
): boolean {
    const expectedIds = new Set(transitions.flatMap((lane) => lane.takesBefore.map((take) => take.id)));
    const actual = lanes.flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === clipId || expectedIds.has(take.id)).map((take) => ({ lane, take }))
    );
    if (actual.length !== expectedIds.size) {
        return false;
    }
    return transitions.every((transition) => {
        const owners = lanes.filter((lane) => lane.id === transition.laneId);
        const owner = owners[0];
        if (owners.length !== 1 || !owner || owner.trackId !== transition.trackId) {
            return false;
        }
        const expected = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
        const takeIds = new Set(expected.map((take) => take.id));
        const regions = owner.activeCompRegions.filter((region) => takeIds.has(region.takeId));
        const expectedRegions = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
        if (!valuesEqual(regions, expectedRegions)) {
            return false;
        }
        return expected.every((take) => {
            const matches = actual.filter((owner) => owner.take.id === take.id);
            return (
                matches.length === 1 &&
                matches[0]?.lane.id === transition.laneId &&
                valuesEqual(audioClipTrimTakeInputs(matches[0].take), audioClipTrimTakeInputs(take))
            );
        });
    });
}

function presence(take: Take, field: (typeof writtenFields)[number]): OptionalNumberValue {
    const value = take[field];
    return Object.hasOwn(take, field) && value !== undefined ? { present: true, value } : { present: false };
}

/** Replay only source-field operations; never re-key, recover or reorder owners. */
export function projectAudioClipTrimTakeSources(
    lanes: readonly TakeLane[],
    clipId: string,
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore'
): TakeLane[] | null {
    if (!audioClipTrimTakeSourcesMatch(lanes, clipId, transitions, direction)) {
        return null;
    }
    const operations: TakeLaneWriteOperation[] = [];
    for (const transition of transitions) {
        const sourceOperations = captureCompRegionSourceOperations(
            transition.laneId,
            direction === 'apply' ? transition.regionsBefore : transition.regionsAfter,
            direction === 'apply' ? transition.regionsAfter : transition.regionsBefore
        );
        if (!sourceOperations) {
            return null;
        }
        operations.push(...sourceOperations);
        for (const [index, before] of transition.takesBefore.entries()) {
            const after = transition.takesAfter[index];
            if (!after) {
                return null;
            }
            for (const field of writtenFields) {
                const original = presence(before, field);
                const captured = presence(after, field);
                if (valuesEqual(original, captured)) {
                    continue;
                }
                operations.push({
                    kind: 'take-optional-number-field',
                    laneId: transition.laneId,
                    takeId: before.id,
                    field,
                    expected: direction === 'apply' ? original : captured,
                    replacement: direction === 'apply' ? captured : original,
                });
            }
        }
    }
    const replayed = replayTakeLaneWriteJournal({ lanes: [...lanes] }, operations);
    return replayed.status === 'applied' && replayed.value ? replayed.value.lanes : null;
}
