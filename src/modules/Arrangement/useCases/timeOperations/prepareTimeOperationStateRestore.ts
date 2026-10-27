import { batchStoreUpdates } from '#/infra/store/createStore';
import { restampLoopOriginEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from '../../models/Track';
import { getTrackState, type TrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { collectLiveClipIds } from '../../services/collectLiveClipIds';
import { markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { planTakeRetirement } from '../comping/planTakeRetirement';
import { reconcileTransitionBaseGaps } from '../comping/reconcileTakeReKeySources';
import { restoreTakesForClip } from '../comping/restoreTakesForClip';

import { clipSatelliteStateCodec } from './clipSatelliteStateCodec';
import { isValidClipSatelliteStateRestorePlan } from './isValidClipSatelliteStateRestorePlan';
import { prepareClipSatelliteStateRestore } from './prepareClipSatelliteStateRestore';
import { prepareTakeLaneStateRestore } from './prepareTakeLaneStateRestore';
import { reverseTakeLaneTransitionPlan } from './reverseTakeLaneTransitionPlan';
import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';
import { timeOperationDependencies, type TimeOperationDependencies } from './timeOperationDependencies';
import { timeOperationStateCodec } from './timeOperationStateCodec';
import { validateTakeLaneTransitionPlan } from './validateTakeLaneTransitionPlan';

type PreparedHandle = {
    name: string;
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
    recoverAfterFailedApply: () => unknown[];
};

type LocalStatePair = {
    trackState: unknown;
    markerState: unknown;
};

type LocalStateRestorePlan = {
    version: 1;
    expected: LocalStatePair;
    replacement: LocalStatePair;
};

type CombinedStateRestorePlan = {
    version: 1;
    scope: 'global' | 'selected-range';
    local: LocalStateRestorePlan;
    automation: Record<string, unknown> | null;
    midi: Record<string, unknown> | null;
    timelineMap: Record<string, unknown> | null;
    clipSatellites: Record<string, unknown> | null;
    takeLanes: TakeLaneTransitionPlan | null;
};

type PreparedLocalState = {
    capturedTrackState: TrackState;
    capturedTrackSnapshot: unknown;
    replacementTrackState: TrackState;
    replacementTrackSnapshot: unknown;
    capturedMarkerState: MarkerStoreState | null;
    capturedMarkerSnapshot: unknown;
    replacementMarkerState: MarkerStoreState | null;
    replacementMarkerSnapshot: unknown;
    trackHasChanges: boolean;
    markerHasChanges: boolean;
};

type PreparedCombinedState = {
    plan: CombinedStateRestorePlan;
    handles: readonly PreparedHandle[];
    hasChanges: boolean;
    preflight: () => boolean;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

const COMBINED_PLAN_KEYS = [
    'version',
    'scope',
    'local',
    'automation',
    'midi',
    'timelineMap',
    'clipSatellites',
] as const;
// Plans written before take-lane retirement joined the operation (#4520) carry
// no `takeLanes` key, so it stays optional: absent means the operation retired
// no takes, exactly like a present null.
const COMBINED_PLAN_WITH_TAKE_LANES_KEYS = [...COMBINED_PLAN_KEYS, 'takeLanes'] as const;
const LOCAL_PLAN_KEYS = ['version', 'expected', 'replacement'] as const;
const LOCAL_STATE_PAIR_KEYS = ['trackState', 'markerState'] as const;
const OWNER_PLAN_KEYS = ['version', 'expected', 'replacement'] as const;

export class UnrecoveredTimeOperationStateError extends Error {
    readonly originalFailure: unknown;
    readonly compensationFailures: readonly unknown[];

    constructor(originalFailure: unknown, compensationFailures: readonly unknown[]) {
        super('Time operation restore left unrecovered partial state', {
            cause: new AggregateError(
                [originalFailure, ...compensationFailures],
                'Time operation publication and compensation both failed'
            ),
        });
        this.name = 'UnrecoveredTimeOperationStateError';
        this.originalFailure = originalFailure;
        this.compensationFailures = compensationFailures;
    }
}

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
        return null;
    }

    const expectedKeySet = new Set(expectedKeys);
    const properties: Record<string, unknown> = {};
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string' || !expectedKeySet.has(ownKey)) {
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        Object.defineProperty(properties, ownKey, {
            configurable: true,
            enumerable: true,
            value: descriptor.value,
            writable: true,
        });
    }
    return properties;
}

function validateLocalStatePair(value: unknown, scope: CombinedStateRestorePlan['scope']): LocalStatePair | null {
    const properties = readDataObject(value, LOCAL_STATE_PAIR_KEYS);
    if (!properties) {
        return null;
    }

    const trackState = timeOperationStateCodec.decodeTrackState(properties.trackState);
    if (!trackState) {
        return null;
    }

    if (scope === 'selected-range') {
        if (properties.markerState !== null) {
            return null;
        }
    } else if (!timeOperationStateCodec.decodeMarkerState(properties.markerState)) {
        return null;
    }

    return {
        trackState: properties.trackState,
        markerState: properties.markerState,
    };
}

function validateLocalPlan(value: unknown, scope: CombinedStateRestorePlan['scope']): LocalStateRestorePlan | null {
    const properties = readDataObject(value, LOCAL_PLAN_KEYS);
    if (!properties || properties.version !== 1) {
        return null;
    }

    const expected = validateLocalStatePair(properties.expected, scope);
    const replacement = validateLocalStatePair(properties.replacement, scope);
    if (!expected || !replacement) {
        return null;
    }
    return {
        version: 1,
        expected,
        replacement,
    };
}

function validateOwnerPlan(value: unknown): Record<string, unknown> | null {
    if (value === null) {
        return null;
    }

    let properties = readDataObject(value, OWNER_PLAN_KEYS);
    if (!properties) {
        const decoded = timeOperationStateCodec.decodeOpaqueJsonPlan(value);
        properties = readDataObject(decoded, OWNER_PLAN_KEYS);
    }
    if (!properties || properties.version !== 1) {
        return null;
    }
    return properties;
}

function takeRetirementsMatchLocalState(local: LocalStateRestorePlan, takeLanes: TakeLaneTransitionPlan): boolean {
    const expected = timeOperationStateCodec.decodeTrackState(local.expected.trackState);
    const replacement = timeOperationStateCodec.decodeTrackState(local.replacement.trackState);
    if (!expected || !replacement) {
        return false;
    }
    const before = takeLanes.appliedEffect === 'restore' ? replacement : expected;
    const after = takeLanes.appliedEffect === 'restore' ? expected : replacement;
    const beforeIds = collectLiveClipIds(before.tracks);
    const afterIds = collectLiveClipIds(after.tracks);
    return (
        new Set(takeLanes.removedClipIds).size === takeLanes.removedClipIds.length &&
        takeLanes.removedClipIds.every((id) => beforeIds.has(id) && !afterIds.has(id))
    );
}

function takeRetirementsMatchDeletedRange(
    plan: CombinedStateRestorePlan,
    range: { startBeat: number; endBeat: number }
): boolean {
    if (plan.takeLanes === null) {
        return true;
    }
    const localBefore = plan.takeLanes.appliedEffect === 'restore' ? plan.local.replacement : plan.local.expected;
    const localAfter = plan.takeLanes.appliedEffect === 'restore' ? plan.local.expected : plan.local.replacement;
    const before = timeOperationStateCodec.decodeTrackState(localBefore.trackState);
    const after = timeOperationStateCodec.decodeTrackState(localAfter.trackState);
    if (!before || !after) {
        return false;
    }
    const afterIds = collectLiveClipIds(after.tracks);
    // A right fragment can replace its source id without erasing its material.
    // Only a clip wholly inside the original delete span belongs to retirement.
    const erasedIds = new Set(
        before.tracks.flatMap((track) =>
            [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)]
                .filter(
                    (clip) =>
                        clip.startBeat >= range.startBeat && clip.endBeat <= range.endBeat && !afterIds.has(clip.id)
                )
                .map((clip) => clip.id)
        )
    );
    return (
        erasedIds.size === plan.takeLanes.removedClipIds.length &&
        plan.takeLanes.removedClipIds.every((id) => erasedIds.has(id))
    );
}

/** Satellite writes follow erased clips and surviving re-keyed sources, never every shifted clip. */
function rightSurvivorMatches(candidate: Clip, original: Clip, expected: Clip): boolean {
    if (!hasExactAudioSourceFields(original) || !hasExactAudioSourceFields(candidate)) {
        return false;
    }
    if (original.type !== 'audio') {
        return timeOperationStateCodec.valuesEqual(candidate, expected);
    }
    if (!Object.hasOwn(candidate, 'audioOffsetSeconds')) {
        return (
            !Object.hasOwn(original, 'audioOffsetSeconds') && timeOperationStateCodec.valuesEqual(candidate, expected)
        );
    }
    const sourceFields = new Set([
        'audioOffsetSeconds',
        'audioUnwrappedOffsetSeconds',
        'audioLoopStartSeconds',
        'audioLoopPassEntrySeconds',
        'audioLoopPassOriginBeat',
    ]);
    const ownerFacets = (clip: Clip) =>
        Object.fromEntries(Object.entries(clip).filter(([key]) => !sourceFields.has(key)));
    let expectedOwner = expected;
    if (original.loopEnabled) {
        expectedOwner = {
            ...expected,
            loopLength: projectClipLoopExpansion({
                clipDurationBeats: original.endBeat - original.startBeat,
                configuredLoopLengthBeats: original.loopLength,
                loopEnabled: true,
            }).loopLengthBeats,
        };
    }
    // The saved clock may no longer exist. Source-cut production proves source
    // seconds; satellite authority proves this exact range-derived owner.
    return timeOperationStateCodec.valuesEqual(ownerFacets(candidate), ownerFacets(expectedOwner));
}

function deletedSatelliteOwners(
    before: TrackState,
    after: TrackState,
    range: { startBeat: number; endBeat: number }
): ReadonlySet<string> {
    const owners = new Set<string>();
    const beforeIds = collectLiveClipIds(before.tracks);
    const afterIds = collectLiveClipIds(after.tracks);
    const afterIdCounts = new Map<string, number>();
    for (const track of after.tracks) {
        for (const clip of track.clips) {
            afterIdCounts.set(clip.id, (afterIdCounts.get(clip.id) ?? 0) + 1);
        }
    }
    const duration = range.endBeat - range.startBeat;
    for (const track of before.tracks) {
        const nextTrack = after.tracks.find((candidate) => candidate.id === track.id);
        if (!nextTrack) {
            continue;
        }
        for (const clip of track.clips) {
            if (afterIds.has(clip.id) || clip.startBeat < range.startBeat || clip.startBeat >= range.endBeat) {
                continue;
            }
            if (!hasExactAudioSourceFields(clip)) {
                continue;
            }
            if (clip.endBeat <= range.endBeat) {
                owners.add(clip.id);
                continue;
            }
            // Only the exact right survivor produced by Delete Time owns the
            // source's satellites. A changed local id alone is no authority.
            let rightLoopOrigin: ReturnType<typeof shiftLoopOriginEntry>;
            if (clip.type === 'midi') {
                rightLoopOrigin = restampLoopOriginEntry(clip, range.startBeat);
            } else {
                rightLoopOrigin = shiftLoopOriginEntry(clip, -duration);
            }
            const survivors = nextTrack.clips.filter(
                (candidate) =>
                    !beforeIds.has(candidate.id) &&
                    afterIdCounts.get(candidate.id) === 1 &&
                    rightSurvivorMatches(candidate, clip, {
                        ...clip,
                        id: candidate.id,
                        startBeat: range.startBeat,
                        endBeat: clip.endBeat - duration,
                        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (range.endBeat - clip.startBeat),
                        midiOffsetBeats: 0,
                        ...rightLoopOrigin,
                    })
            );
            if (survivors.length === 1) {
                owners.add(clip.id);
                owners.add(survivors[0]!.id);
            }
        }
    }
    return owners;
}

function satelliteWritesMatchDeletedRange(
    plan: CombinedStateRestorePlan,
    range: { startBeat: number; endBeat: number }
): boolean {
    if (plan.clipSatellites === null) {
        return true;
    }
    const satellites = clipSatelliteStateCodec.decodeRestorePlan(plan.clipSatellites);
    const expected = timeOperationStateCodec.decodeTrackState(plan.local.expected.trackState);
    const replacement = timeOperationStateCodec.decodeTrackState(plan.local.replacement.trackState);
    if (!satellites || !expected || !replacement) {
        return false;
    }
    const writes = satellites.expected.entries.filter(
        (entry, index) => !timeOperationStateCodec.valuesEqual(entry, satellites.replacement.entries[index])
    );
    // The same saved plan runs in either direction. Each direction must be
    // justified by one complete captured deletion, rather than unioning ids
    // from contradictory interpretations of the two snapshots.
    return [
        deletedSatelliteOwners(expected, replacement, range),
        deletedSatelliteOwners(replacement, expected, range),
    ].some((owners) => writes.every((entry) => owners.has(entry.clipId)));
}

function validateCombinedPlanUnchecked(value: unknown): CombinedStateRestorePlan | null {
    const cloned = timeOperationStateCodec.cloneJsonPlan(value);
    const properties =
        readDataObject(cloned, COMBINED_PLAN_WITH_TAKE_LANES_KEYS) ?? readDataObject(cloned, COMBINED_PLAN_KEYS);
    if (!properties || properties.version !== 1) {
        return null;
    }
    if (properties.scope !== 'global' && properties.scope !== 'selected-range') {
        return null;
    }

    const local = validateLocalPlan(properties.local, properties.scope);
    if (!local) {
        return null;
    }

    // A selected-range deletion never moves the timeline map: it edits clips on
    // chosen tracks, not project time. It does retire the satellites of the
    // clips it removes, so those two slots may carry a plan.
    if (properties.scope === 'selected-range' && properties.timelineMap !== null) {
        return null;
    }

    const automation = validateOwnerPlan(properties.automation);
    const midi = validateOwnerPlan(properties.midi);
    const timelineMap = validateOwnerPlan(properties.timelineMap);
    const clipSatellites = validateOwnerPlan(properties.clipSatellites);
    if (properties.automation !== null && automation === null) {
        return null;
    }
    if (properties.midi !== null && midi === null) {
        return null;
    }
    if (properties.timelineMap !== null && timelineMap === null) {
        return null;
    }
    if (properties.clipSatellites !== null && clipSatellites === null) {
        return null;
    }

    const takeLanesValue: unknown = properties.takeLanes ?? null;
    const takeLanes = takeLanesValue === null ? null : validateTakeLaneTransitionPlan(takeLanesValue);
    if (takeLanesValue !== null && takeLanes === null) {
        return null;
    }
    if (takeLanes !== null && !takeRetirementsMatchLocalState(local, takeLanes)) {
        return null;
    }

    return {
        version: 1,
        scope: properties.scope,
        local,
        automation,
        midi,
        timelineMap,
        clipSatellites,
        takeLanes,
    };
}

function validateCombinedPlan(value: unknown): CombinedStateRestorePlan | null {
    try {
        return validateCombinedPlanUnchecked(value);
    } catch {
        return null;
    }
}

/** Validate a persisted replay plan without consulting or writing live project state. */
export const timeOperationRestorePlan = {
    isValid(value: unknown, deletedRange?: { startBeat: number; endBeat: number }): boolean {
        const validators = timeOperationDependencies?.savedRestorePlanValidators;
        if (!validators) {
            return false;
        }
        const plan = validateCombinedPlan(value);
        return (
            plan !== null &&
            (deletedRange === undefined ||
                (takeRetirementsMatchDeletedRange(plan, deletedRange) &&
                    satelliteWritesMatchDeletedRange(plan, deletedRange))) &&
            (plan.automation === null || validators.automation(plan.automation)) &&
            (plan.midi === null || validators.midi(plan.midi)) &&
            (plan.timelineMap === null || validators.timelineMap(plan.timelineMap)) &&
            (plan.clipSatellites === null || isValidClipSatelliteStateRestorePlan(plan.clipSatellites))
        );
    },
};

function prepareLocalState(plan: CombinedStateRestorePlan): PreparedLocalState | null {
    const capturedTrackState = getTrackState();
    if (!capturedTrackState) {
        return null;
    }

    const expectedTrackSnapshot = plan.local.expected.trackState;
    const replacementTrackSnapshot = plan.local.replacement.trackState;
    if (!timeOperationStateCodec.trackStateMatchesSnapshot(capturedTrackState, expectedTrackSnapshot)) {
        return null;
    }
    const decodedReplacement = timeOperationStateCodec.decodeTrackState(replacementTrackSnapshot);
    if (!decodedReplacement) {
        return null;
    }
    const replacementTrackState = { ...capturedTrackState, tracks: decodedReplacement.tracks };

    let capturedMarkerState: MarkerStoreState | null = null;
    let replacementMarkerState: MarkerStoreState | null = null;
    let markerHasChanges = false;
    if (plan.scope === 'global') {
        capturedMarkerState = markerStore.value;
        if (!timeOperationStateCodec.markerStateMatchesSnapshot(capturedMarkerState, plan.local.expected.markerState)) {
            return null;
        }
        replacementMarkerState = timeOperationStateCodec.decodeMarkerState(plan.local.replacement.markerState);
        if (!replacementMarkerState) {
            return null;
        }
        markerHasChanges = !timeOperationStateCodec.valuesEqual(
            plan.local.expected.markerState,
            plan.local.replacement.markerState
        );
    }

    return {
        capturedTrackState,
        capturedTrackSnapshot: expectedTrackSnapshot,
        replacementTrackState,
        replacementTrackSnapshot,
        capturedMarkerState,
        capturedMarkerSnapshot: plan.local.expected.markerState,
        replacementMarkerState,
        replacementMarkerSnapshot: plan.local.replacement.markerState,
        trackHasChanges: !timeOperationStateCodec.valuesEqual(capturedTrackState.tracks, replacementTrackState.tracks),
        markerHasChanges,
    };
}

function trackMatches(state: TrackState | null, reference: TrackState, snapshot: unknown): boolean {
    if (state !== reference) {
        return false;
    }
    return timeOperationStateCodec.trackStateMatchesSnapshot(state, snapshot);
}

function markerMatches(state: MarkerStoreState | null, reference: MarkerStoreState, snapshot: unknown): boolean {
    if (state !== reference) {
        return false;
    }
    return timeOperationStateCodec.markerStateMatchesSnapshot(state, snapshot);
}

function collectLocalCompensationFailures(input: {
    prepared: PreparedLocalState;
    restoreTrack: boolean;
    restoreMarker: boolean;
    expectedTrackState: TrackState;
    expectedTrackSnapshot: unknown;
    replacementTrackState: TrackState;
    replacementTrackSnapshot: unknown;
    expectedMarkerState: MarkerStoreState | null;
    expectedMarkerSnapshot: unknown;
    replacementMarkerState: MarkerStoreState | null;
    replacementMarkerSnapshot: unknown;
}): unknown[] {
    const failures: unknown[] = [];
    if (input.restoreMarker) {
        const expectedMarkerState = input.expectedMarkerState;
        const replacementMarkerState = input.replacementMarkerState;
        if (!expectedMarkerState || !replacementMarkerState) {
            failures.push(new Error('Marker compensation is missing a complete state pair'));
        } else if (!markerMatches(markerStore.value, expectedMarkerState, input.expectedMarkerSnapshot)) {
            failures.push(new Error('Marker compensation found an unexpected state'));
        } else {
            try {
                markerStore.set(replacementMarkerState);
            } catch (error) {
                failures.push(error);
            }
            if (!markerMatches(markerStore.value, replacementMarkerState, input.replacementMarkerSnapshot)) {
                failures.push(new Error('Marker compensation did not restore the complete state'));
            }
        }
    }

    if (input.restoreTrack) {
        if (!trackMatches(getTrackState(), input.expectedTrackState, input.expectedTrackSnapshot)) {
            failures.push(new Error('Arrangement compensation found an unexpected state'));
        } else {
            try {
                setTrackState(input.replacementTrackState);
            } catch (error) {
                failures.push(error);
            }
            if (!trackMatches(getTrackState(), input.replacementTrackState, input.replacementTrackSnapshot)) {
                failures.push(new Error('Arrangement compensation did not restore the complete state'));
            }
        }
    }
    return failures;
}

function createLocalHandle(prepared: PreparedLocalState): PreparedHandle {
    const hasChanges = prepared.trackHasChanges || prepared.markerHasChanges;
    let phase: TransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function publish(input: {
        expectedTrackState: TrackState;
        expectedTrackSnapshot: unknown;
        replacementTrackState: TrackState;
        replacementTrackSnapshot: unknown;
        expectedMarkerState: MarkerStoreState | null;
        expectedMarkerSnapshot: unknown;
        replacementMarkerState: MarkerStoreState | null;
        replacementMarkerSnapshot: unknown;
        nextPhase: 'applied' | 'closed';
    }): boolean {
        if (
            !trackMatches(getTrackState(), input.expectedTrackState, input.expectedTrackSnapshot) ||
            !timeOperationStateCodec.trackStateMatchesSnapshot(
                input.replacementTrackState,
                input.replacementTrackSnapshot
            )
        ) {
            phase = 'closed';
            return false;
        }
        if (prepared.markerHasChanges) {
            const expectedMarkerState = input.expectedMarkerState;
            const replacementMarkerState = input.replacementMarkerState;
            if (
                !expectedMarkerState ||
                !replacementMarkerState ||
                !markerMatches(markerStore.value, expectedMarkerState, input.expectedMarkerSnapshot) ||
                !timeOperationStateCodec.markerStateMatchesSnapshot(
                    replacementMarkerState,
                    input.replacementMarkerSnapshot
                )
            ) {
                phase = 'closed';
                return false;
            }
        }

        phase = 'publishing';
        let trackPublished = false;
        let markerPublished = false;
        try {
            if (prepared.trackHasChanges) {
                setTrackState(input.replacementTrackState);
                trackPublished = trackMatches(
                    getTrackState(),
                    input.replacementTrackState,
                    input.replacementTrackSnapshot
                );
                if (!trackPublished) {
                    throw new Error('Arrangement did not publish the prepared state');
                }
            }
            const replacementMarkerState = input.replacementMarkerState;
            if (prepared.markerHasChanges && replacementMarkerState) {
                markerStore.set(replacementMarkerState);
                markerPublished = markerMatches(
                    markerStore.value,
                    replacementMarkerState,
                    input.replacementMarkerSnapshot
                );
                if (!markerPublished) {
                    throw new Error('Markers did not publish the prepared state');
                }
            }
        } catch (error) {
            const publicationStateFailures: unknown[] = [];
            if (
                prepared.trackHasChanges &&
                trackMatches(getTrackState(), input.replacementTrackState, input.replacementTrackSnapshot)
            ) {
                trackPublished = true;
            } else if (
                prepared.trackHasChanges &&
                !trackMatches(getTrackState(), input.expectedTrackState, input.expectedTrackSnapshot)
            ) {
                publicationStateFailures.push(new Error('Arrangement publication left an unexpected state'));
            }
            const replacementMarkerState = input.replacementMarkerState;
            if (
                prepared.markerHasChanges &&
                replacementMarkerState &&
                markerMatches(markerStore.value, replacementMarkerState, input.replacementMarkerSnapshot)
            ) {
                markerPublished = true;
            } else if (
                prepared.markerHasChanges &&
                input.expectedMarkerState &&
                !markerMatches(markerStore.value, input.expectedMarkerState, input.expectedMarkerSnapshot)
            ) {
                publicationStateFailures.push(new Error('Marker publication left an unexpected state'));
            }
            const compensationFailures = [
                ...publicationStateFailures,
                ...collectLocalCompensationFailures({
                    prepared,
                    restoreTrack: trackPublished,
                    restoreMarker: markerPublished,
                    expectedTrackState: input.replacementTrackState,
                    expectedTrackSnapshot: input.replacementTrackSnapshot,
                    replacementTrackState: input.expectedTrackState,
                    replacementTrackSnapshot: input.expectedTrackSnapshot,
                    expectedMarkerState: input.replacementMarkerState,
                    expectedMarkerSnapshot: input.replacementMarkerSnapshot,
                    replacementMarkerState: input.expectedMarkerState,
                    replacementMarkerSnapshot: input.expectedMarkerSnapshot,
                }),
            ];
            phase = 'closed';
            if (compensationFailures.length > 0) {
                throw new UnrecoveredTimeOperationStateError(error, compensationFailures);
            }
            throw error;
        }

        phase = input.nextPhase;
        return true;
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        return publish({
            expectedTrackState: prepared.capturedTrackState,
            expectedTrackSnapshot: prepared.capturedTrackSnapshot,
            replacementTrackState: prepared.replacementTrackState,
            replacementTrackSnapshot: prepared.replacementTrackSnapshot,
            expectedMarkerState: prepared.capturedMarkerState,
            expectedMarkerSnapshot: prepared.capturedMarkerSnapshot,
            replacementMarkerState: prepared.replacementMarkerState,
            replacementMarkerSnapshot: prepared.replacementMarkerSnapshot,
            nextPhase: 'applied',
        });
    }

    function revert(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        return publish({
            expectedTrackState: prepared.replacementTrackState,
            expectedTrackSnapshot: prepared.replacementTrackSnapshot,
            replacementTrackState: prepared.capturedTrackState,
            replacementTrackSnapshot: prepared.capturedTrackSnapshot,
            expectedMarkerState: prepared.replacementMarkerState,
            expectedMarkerSnapshot: prepared.replacementMarkerSnapshot,
            replacementMarkerState: prepared.capturedMarkerState,
            replacementMarkerSnapshot: prepared.capturedMarkerSnapshot,
            nextPhase: 'closed',
        });
    }

    return {
        name: 'Arrangement',
        hasChanges,
        apply,
        revert,
        recoverAfterFailedApply: () => [],
    };
}

function prepareChangedOwner(
    plan: Record<string, unknown>,
    prepare: (plan: unknown) => ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>
): ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']> | null {
    try {
        const preparation = prepare(plan);
        if (preparation.status !== 'ready' || !preparation.hasChanges) {
            return null;
        }
        return preparation;
    } catch {
        return null;
    }
}

function recoverOwnerAfterFailedApply(input: {
    name: string;
    plan: Record<string, unknown>;
    prepare: (plan: unknown) => ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>;
}): unknown[] {
    const expectedStatePreparation = prepareChangedOwner(input.plan, input.prepare);
    if (expectedStatePreparation) {
        return [];
    }

    const reversedPlan = reverseOwnerPlan(input.plan);
    if (!reversedPlan) {
        return [new Error(`${input.name} recovery could not reverse its state plan`)];
    }
    const recovery = prepareChangedOwner(reversedPlan, input.prepare);
    if (!recovery) {
        return [new Error(`${input.name} publication left an unexpected state`)];
    }

    let recoveryFailure: unknown = null;
    try {
        if (!recovery.apply()) {
            recoveryFailure = new Error(`${input.name} recovery publication returned false`);
        }
    } catch (error) {
        recoveryFailure = error;
    }

    const restoredStatePreparation = prepareChangedOwner(input.plan, input.prepare);
    if (restoredStatePreparation) {
        return [];
    }
    if (recoveryFailure === null) {
        return [new Error(`${input.name} recovery did not restore its captured state`)];
    }
    return [recoveryFailure, new Error(`${input.name} recovery did not restore its captured state`)];
}

function toNamedHandle(
    name: string,
    plan: Record<string, unknown>,
    prepare: (plan: unknown) => ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>,
    preparation: ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>
): PreparedHandle {
    return {
        name,
        hasChanges: preparation.hasChanges,
        apply: preparation.apply,
        revert: preparation.revert,
        recoverAfterFailedApply: () => recoverOwnerAfterFailedApply({ name, plan, prepare }),
    };
}

function prepareOwner(
    name: string,
    plan: Record<string, unknown> | null,
    prepare: (plan: unknown) => ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>
): PreparedHandle | null | false {
    if (plan === null) {
        return null;
    }

    const preparation = prepare(plan);
    if (preparation.status !== 'ready' || !preparation.hasChanges) {
        return false;
    }
    return toNamedHandle(name, plan, prepare, preparation);
}

function localStateIsStillPrepared(prepared: PreparedLocalState): boolean {
    if (
        !trackMatches(getTrackState(), prepared.capturedTrackState, prepared.capturedTrackSnapshot) ||
        !timeOperationStateCodec.trackStateMatchesSnapshot(
            prepared.replacementTrackState,
            prepared.replacementTrackSnapshot
        )
    ) {
        return false;
    }

    if (prepared.capturedMarkerState === null && prepared.replacementMarkerState === null) {
        return true;
    }
    if (prepared.capturedMarkerState === null || prepared.replacementMarkerState === null) {
        return false;
    }
    return (
        markerMatches(markerStore.value, prepared.capturedMarkerState, prepared.capturedMarkerSnapshot) &&
        timeOperationStateCodec.markerStateMatchesSnapshot(
            prepared.replacementMarkerState,
            prepared.replacementMarkerSnapshot
        )
    );
}

function takeLaneSourcesAndTakesAreStillPrepared(plan: TakeLaneTransitionPlan | null): boolean {
    if (!plan) {
        return true;
    }
    const lanes = takeLaneStore.value?.lanes ?? [];
    const direction = plan.appliedEffect === 'restore' ? 'restore' : 'apply';
    const replayFacets = (take: NonNullable<TakeLaneTransitionPlan['reKeyedLanes']>[number]['takesBefore'][number]) =>
        Object.fromEntries(Object.entries(take).filter(([key, value]) => key !== 'selected' && value !== undefined));
    return (plan.reKeyedLanes ?? []).every((transition) => {
        const owner = lanes.find((lane) => lane.id === transition.laneId || lane.trackId === transition.trackId);
        const from = direction === 'restore' ? transition.takesAfter : transition.takesBefore;
        const to = direction === 'restore' ? transition.takesBefore : transition.takesAfter;
        const toById = new Map(to.map((take) => [take.id, take]));
        const reserved = new Map(to.map((take) => [take.id, take.clipId]));
        for (const take of from) {
            reserved.set(take.id, take.clipId);
        }
        return (
            reconcileTransitionBaseGaps(
                owner ?? { id: transition.laneId, trackId: transition.trackId, takes: [], activeCompRegions: [] },
                transition,
                direction
            ) !== null &&
            lanes.every((lane) => lane.id !== transition.laneId || lane.trackId === transition.trackId) &&
            lanes.every((lane) =>
                lane.takes.every(
                    (take) => !reserved.has(take.id) || (lane === owner && take.clipId === reserved.get(take.id))
                )
            ) &&
            from.every((source) => {
                const target = toById.get(source.id);
                if (target && timeOperationStateCodec.valuesEqual(replayFacets(source), replayFacets(target))) {
                    return true;
                }
                const live = owner?.takes.find((take) => take.id === source.id);
                return !live || timeOperationStateCodec.valuesEqual(replayFacets(live), replayFacets(source));
            })
        );
    });
}

function prepareDisappearingClipTakeRetirement(
    local: PreparedLocalState,
    takeLanes: TakeLaneTransitionPlan | null
): PreparedHandle | null {
    const replacementClipIds = collectLiveClipIds(local.replacementTrackState.tracks);
    const disappearingClipIds = local.capturedTrackState.tracks.flatMap((track) =>
        track.clips.filter((clip) => !replacementClipIds.has(clip.id)).map((clip) => clip.id)
    );
    const capturedState = takeLaneStore.value;
    // Captured identities must reach their own transition: removing them first
    // can leave the owning leg without a lane to retire or reconcile.
    const transitionTakeIds = new Set(
        (takeLanes?.reKeyedLanes ?? []).flatMap((lane) =>
            (takeLanes?.appliedEffect === 'restore' ? lane.takesAfter : lane.takesBefore).map((take) => take.id)
        )
    );
    const planOwnedLaneIds = new Set<string>();
    if (takeLanes?.appliedEffect === 'retire') {
        for (const snapshot of takeLanes.retiredLanes) {
            planOwnedLaneIds.add(snapshot.lane.id);
            for (const takeId of snapshot.retiredTakeIds ?? []) {
                transitionTakeIds.add(takeId);
            }
        }
    }
    // A retire plan owns its captured hosts; other live hosts may have existed
    // empty before deletion or replaced the captured lane through a peer edit.
    const preservedLaneIds = new Set(
        (capturedState?.lanes ?? []).filter((lane) => !planOwnedLaneIds.has(lane.id)).map((lane) => lane.id)
    );
    // The joined transition also owns its exact FROM source tiles. Retiring
    // them here makes that owner's later source guard refuse its own replay.
    const preservedBaseGapAudioSources = (takeLanes?.reKeyedLanes ?? []).flatMap(
        (lane) =>
            (takeLanes?.appliedEffect === 'restore' ? lane.baseGapAudioSourcesAfter : lane.baseGapAudioSourcesBefore) ??
            []
    );
    if (takeLanes?.appliedEffect === 'retire') {
        preservedBaseGapAudioSources.push(
            ...takeLanes.retiredLanes.flatMap((snapshot) => snapshot.retiredBaseGapAudioSources ?? [])
        );
    }
    const retirement = planTakeRetirement(disappearingClipIds, transitionTakeIds, {
        preservedLaneIds,
        preservedBaseGapAudioSources,
    });
    if (!retirement) {
        return null;
    }
    const nextState = { lanes: retirement.lanes };
    const retiredLanes = retirement.retiredLanes;
    let publicationAttempted = false;

    function restore(): boolean {
        if (!publicationAttempted) {
            return true;
        }
        restoreTakesForClip(retiredLanes);
        for (const snapshot of retiredLanes) {
            const live = takeLaneStore.value?.lanes.find(
                (lane) => lane.id === snapshot.lane.id || lane.trackId === snapshot.lane.trackId
            );
            const retiredTakeIds = new Set(snapshot.retiredTakeIds);
            for (const take of snapshot.lane.takes.filter((take) => retiredTakeIds.has(take.id))) {
                if (
                    !timeOperationStateCodec.valuesEqual(
                        live?.takes.find((entry) => entry.id === take.id),
                        take
                    )
                ) {
                    return false;
                }
            }
            for (const region of snapshot.lane.activeCompRegions.filter((region) =>
                retiredTakeIds.has(region.takeId)
            )) {
                if (!live?.activeCompRegions.some((entry) => timeOperationStateCodec.valuesEqual(entry, region))) {
                    return false;
                }
            }
        }
        return true;
    }

    return {
        name: 'Disappearing clip takes',
        hasChanges: true,
        apply: () => {
            if (takeLaneStore.value !== capturedState) {
                return false;
            }
            publicationAttempted = true;
            takeLaneStore.set(nextState);
            return takeLaneStore.value === nextState;
        },
        revert: restore,
        recoverAfterFailedApply: () => {
            try {
                return restore() ? [] : [new Error('Disappearing clip takes could not be restored')];
            } catch (error) {
                return [error];
            }
        },
    };
}

function prepareCombinedStateUnchecked(value: unknown, deps: TimeOperationDependencies): PreparedCombinedState | null {
    const plan = validateCombinedPlan(value);
    if (!plan) {
        return null;
    }
    const localState = prepareLocalState(plan);
    if (!localState) {
        return null;
    }

    const localHandle = createLocalHandle(localState);
    const automation = prepareOwner('Automation', plan.automation, deps.prepareAutomationTimeStateRestore);
    if (automation === false) {
        return null;
    }
    const midi = prepareOwner('MIDI', plan.midi, deps.prepareMidiTimeStateRestore);
    if (midi === false) {
        return null;
    }
    const timelineMap = prepareOwner('Transport', plan.timelineMap, deps.prepareTimelineMapStateRestore);
    if (timelineMap === false) {
        return null;
    }
    const clipSatellites = prepareOwner('Clip satellites', plan.clipSatellites, prepareClipSatelliteStateRestore);
    if (clipSatellites === false) {
        return null;
    }
    // Take lanes join last in both scopes (#4520): the restore direction needs
    // the clips back on their tracks first (a lane whose track is gone, or a
    // take whose clip is gone, has nothing to resolve against and is skipped),
    // and the retire direction is order-independent.
    const takeLanes = plan.takeLanes === null ? null : prepareTakeLaneStateRestore(plan.takeLanes);

    const handles: PreparedHandle[] = [];
    // Snapshots also name disappearing fragments when no take existed at capture.
    // Retire their live facets first: compensation restores them last, once the
    // prior clip geometry is back. Successful replay never sweeps unrelated orphans.
    const disappearingTakes = prepareDisappearingClipTakeRetirement(localState, plan.takeLanes);
    if (disappearingTakes) {
        handles.push(disappearingTakes);
    }
    if (plan.scope === 'selected-range') {
        if (midi) {
            handles.push(midi);
        }
        if (automation) {
            handles.push(automation);
        }
        if (clipSatellites) {
            handles.push(clipSatellites);
        }
        if (localHandle.hasChanges) {
            handles.push(localHandle);
        }
    } else {
        if (localHandle.hasChanges) {
            handles.push(localHandle);
        }
        if (automation) {
            handles.push(automation);
        }
        if (timelineMap) {
            handles.push(timelineMap);
        }
        if (midi) {
            handles.push(midi);
        }
        if (clipSatellites) {
            handles.push(clipSatellites);
        }
    }
    if (takeLanes) {
        handles.push(takeLanes);
    }

    return {
        plan,
        handles,
        hasChanges: handles.length > 0,
        preflight: () =>
            localStateIsStillPrepared(localState) && takeLaneSourcesAndTakesAreStillPrepared(plan.takeLanes),
    };
}

function prepareCombinedState(value: unknown, deps: TimeOperationDependencies): PreparedCombinedState | null {
    try {
        return prepareCombinedStateUnchecked(value, deps);
    } catch {
        return null;
    }
}

function compensateAppliedHandles(applied: readonly PreparedHandle[]): unknown[] {
    const failures: unknown[] = [];
    for (let index = applied.length - 1; index >= 0; index -= 1) {
        const handle = applied[index];
        if (!handle) {
            continue;
        }
        try {
            if (!handle.revert()) {
                failures.push(new Error(`${handle.name} compensation returned false`));
            }
        } catch (error) {
            if (error instanceof UnrecoveredTimeOperationStateError) {
                failures.push(error.originalFailure, ...error.compensationFailures);
            } else {
                failures.push(error);
            }
        }
    }
    return failures;
}

function collectFailedHandleRecoveryFailures(handle: PreparedHandle): unknown[] {
    try {
        return handle.recoverAfterFailedApply();
    } catch (error) {
        return [error];
    }
}

function publishHandles(handles: readonly PreparedHandle[], preflight: () => boolean): boolean {
    return batchStoreUpdates(() => {
        if (!preflight()) {
            return false;
        }
        const applied: PreparedHandle[] = [];
        for (const handle of handles) {
            let appliedSuccessfully: boolean;
            try {
                appliedSuccessfully = handle.apply();
            } catch (error) {
                const compensationFailures = [
                    ...collectFailedHandleRecoveryFailures(handle),
                    ...compensateAppliedHandles(applied),
                ];
                if (error instanceof UnrecoveredTimeOperationStateError) {
                    if (compensationFailures.length === 0) {
                        throw error;
                    }
                    throw new UnrecoveredTimeOperationStateError(error.originalFailure, [
                        ...error.compensationFailures,
                        ...compensationFailures,
                    ]);
                }
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredTimeOperationStateError(error, compensationFailures);
                }
                throw error;
            }

            if (!appliedSuccessfully) {
                const failure = new Error(`${handle.name} publication returned false`);
                const compensationFailures = [
                    ...collectFailedHandleRecoveryFailures(handle),
                    ...compensateAppliedHandles(applied),
                ];
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredTimeOperationStateError(failure, compensationFailures);
                }
                return false;
            }
            applied.push(handle);
        }
        return true;
    });
}

function reverseOwnerPlan(value: Record<string, unknown> | null): Record<string, unknown> | null | false {
    if (value === null) {
        return null;
    }
    const properties = readDataObject(value, OWNER_PLAN_KEYS);
    if (!properties || properties.version !== 1) {
        return false;
    }

    const reversed = {
        version: 1,
        expected: properties.replacement,
        replacement: properties.expected,
    };
    const encoded = timeOperationStateCodec.encodeOpaqueJsonPlan(reversed);
    if (!encoded) {
        return false;
    }
    const cloned = timeOperationStateCodec.decodeOpaqueJsonPlan(encoded);
    if (!cloned) {
        return false;
    }
    return cloned;
}

function serializeOwnerPlan(value: Record<string, unknown> | null): unknown {
    if (value === null) {
        return null;
    }
    const cloned = timeOperationStateCodec.cloneJsonPlan(value);
    if (cloned) {
        return cloned;
    }
    const encoded = timeOperationStateCodec.encodeOpaqueJsonPlan(value);
    if (!encoded) {
        return false;
    }
    return encoded;
}

function reversePlan(plan: CombinedStateRestorePlan): Record<string, unknown> | null {
    const reversedAutomation = reverseOwnerPlan(plan.automation);
    const reversedMidi = reverseOwnerPlan(plan.midi);
    const reversedTimelineMap = reverseOwnerPlan(plan.timelineMap);
    const reversedClipSatellites = reverseOwnerPlan(plan.clipSatellites);
    if (
        reversedAutomation === false ||
        reversedMidi === false ||
        reversedTimelineMap === false ||
        reversedClipSatellites === false
    ) {
        return null;
    }
    const automation = serializeOwnerPlan(reversedAutomation);
    const midi = serializeOwnerPlan(reversedMidi);
    const timelineMap = serializeOwnerPlan(reversedTimelineMap);
    const clipSatellites = serializeOwnerPlan(reversedClipSatellites);
    if (automation === false || midi === false || timelineMap === false || clipSatellites === false) {
        return null;
    }

    return {
        version: 1,
        scope: plan.scope,
        local: {
            version: 1,
            expected: plan.local.replacement,
            replacement: plan.local.expected,
        },
        automation,
        midi,
        timelineMap,
        clipSatellites,
        // Not an expected/replacement pair, so the owner swap above cannot
        // reverse it: flipping the effect is what makes the reversed plan
        // re-retire the lanes this plan restored.
        takeLanes: plan.takeLanes === null ? null : reverseTakeLaneTransitionPlan(plan.takeLanes),
    };
}

function rejectedPreparation() {
    return {
        status: 'rejected' as const,
        hasChanges: false,
        apply: () => false,
        revert: () => false,
    };
}

export function prepareTimeOperationStateRestore(plan: unknown) {
    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

    const prepared = prepareCombinedState(plan, deps);
    if (!prepared) {
        return rejectedPreparation();
    }
    const readyState = prepared;
    const readyDeps = deps;

    let phase: TransactionPhase = 'closed';
    if (readyState.hasChanges) {
        phase = 'prepared';
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            const published = publishHandles(readyState.handles, readyState.preflight);
            if (!published) {
                phase = 'closed';
                return false;
            }
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        const reversedPlan = reversePlan(readyState.plan);
        if (!reversedPlan) {
            phase = 'closed';
            return false;
        }
        const reversed = prepareCombinedState(reversedPlan, readyDeps);
        if (!reversed || !reversed.hasChanges) {
            phase = 'closed';
            return false;
        }

        try {
            const published = publishHandles(reversed.handles, reversed.preflight);
            if (!published) {
                phase = 'closed';
                return false;
            }
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        phase = 'closed';
        return true;
    }

    return {
        status: 'ready' as const,
        hasChanges: readyState.hasChanges,
        apply,
        revert,
    };
}
