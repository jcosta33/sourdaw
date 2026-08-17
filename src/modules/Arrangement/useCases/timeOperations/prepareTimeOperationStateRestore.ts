import { batchStoreUpdates } from '#/infra/store/createStore';

import { getTrackState, type TrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore, type MarkerStoreState } from '../../stores/markerStore';

import { prepareClipSatelliteStateRestore } from './prepareClipSatelliteStateRestore';
import { timeOperationDependencies, type TimeOperationDependencies } from './timeOperationDependencies';
import { timeOperationStateCodec } from './timeOperationStateCodec';

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

function validateCombinedPlanUnchecked(value: unknown): CombinedStateRestorePlan | null {
    const cloned = timeOperationStateCodec.cloneJsonPlan(value);
    const properties = readDataObject(cloned, COMBINED_PLAN_KEYS);
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

    return {
        version: 1,
        scope: properties.scope,
        local,
        automation,
        midi,
        timelineMap,
        clipSatellites,
    };
}

function validateCombinedPlan(value: unknown): CombinedStateRestorePlan | null {
    try {
        return validateCombinedPlanUnchecked(value);
    } catch {
        return null;
    }
}

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
    const replacementTrackState = timeOperationStateCodec.decodeTrackState(replacementTrackSnapshot);
    if (!replacementTrackState) {
        return null;
    }

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
        trackHasChanges: !timeOperationStateCodec.valuesEqual(expectedTrackSnapshot, replacementTrackSnapshot),
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

    const handles: PreparedHandle[] = [];
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

    return {
        plan,
        handles,
        hasChanges: handles.length > 0,
        preflight: () => localStateIsStillPrepared(localState),
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
