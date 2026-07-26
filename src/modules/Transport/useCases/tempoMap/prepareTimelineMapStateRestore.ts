import { batchStoreUpdates } from '#/infra/store/createStore';

import { tempoMapStore, type TempoMapStoreState } from '../../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../../stores/timeSignatureMapStore';

import { timelineMapTimeStateCodec } from './timelineMapTimeStateCodec';

type TimelineMapTimeStateSnapshot = NonNullable<ReturnType<typeof timelineMapTimeStateCodec.encodeState>>;
type DecodedTimelineMapTimeState = NonNullable<ReturnType<typeof timelineMapTimeStateCodec.decodeState>>;

type TimelineMapTimeStateRestorePlan = {
    version: 1;
    expected: TimelineMapTimeStateSnapshot;
    replacement: TimelineMapTimeStateSnapshot;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

type PreparedRestoreState = {
    capturedTempoState: TempoMapStoreState;
    capturedTimeSignatureState: TimeSignatureMapStoreState;
    expectedSnapshot: TimelineMapTimeStateSnapshot;
    replacementTempoState: TempoMapStoreState;
    replacementTimeSignatureState: TimeSignatureMapStoreState;
    replacementSnapshot: TimelineMapTimeStateSnapshot;
    tempoHasChanges: boolean;
    timeSignatureHasChanges: boolean;
    hasChanges: boolean;
};

type PublishTimelineMapStatesInput = {
    tempoState: TempoMapStoreState;
    timeSignatureState: TimeSignatureMapStoreState;
    publishTempo: boolean;
    publishTimeSignature: boolean;
    compensationTempoState: TempoMapStoreState;
    compensationTimeSignatureState: TimeSignatureMapStoreState;
};

class UnrecoveredTimelineMapStateError extends Error {
    readonly publicationFailure: unknown;
    readonly compensationFailure: unknown;

    constructor(publicationFailure: unknown, compensationFailure: unknown) {
        super('Timeline map transaction left unrecovered partial state', {
            cause: new AggregateError(
                [publicationFailure, compensationFailure],
                'Timeline map publication and compensation both failed'
            ),
        });
        this.name = 'UnrecoveredTimelineMapStateError';
        this.publicationFailure = publicationFailure;
        this.compensationFailure = compensationFailure;
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

function validateRestorePlanUnchecked(value: unknown): {
    plan: TimelineMapTimeStateRestorePlan;
    expectedState: DecodedTimelineMapTimeState;
    replacementState: DecodedTimelineMapTimeState;
} | null {
    const properties = readDataObject(value, ['version', 'expected', 'replacement']);
    if (!properties || properties.version !== 1) {
        return null;
    }

    const expectedState = timelineMapTimeStateCodec.decodeState(properties.expected);
    const replacementState = timelineMapTimeStateCodec.decodeState(properties.replacement);
    if (!expectedState || !replacementState) {
        return null;
    }

    const expected = timelineMapTimeStateCodec.encodeState(expectedState);
    const replacement = timelineMapTimeStateCodec.encodeState(replacementState);
    if (!expected || !replacement) {
        return null;
    }

    return {
        plan: {
            version: 1,
            expected,
            replacement,
        },
        expectedState,
        replacementState,
    };
}

function validateRestorePlan(value: unknown): ReturnType<typeof validateRestorePlanUnchecked> {
    try {
        return validateRestorePlanUnchecked(value);
    } catch {
        return null;
    }
}

function statesMatchReferenceAndValue(
    tempoState: TempoMapStoreState,
    timeSignatureState: TimeSignatureMapStoreState,
    snapshot: TimelineMapTimeStateSnapshot
): boolean {
    if (tempoMapStore.value !== tempoState || timeSignatureMapStore.value !== timeSignatureState) {
        return false;
    }
    return timelineMapTimeStateCodec.stateMatchesSnapshot({
        tempoState,
        timeSignatureState,
        snapshot,
    });
}

function prepareRestoreStateUnchecked(plan: unknown): PreparedRestoreState | null {
    const capturedTempoState = tempoMapStore.value;
    const capturedTimeSignatureState = timeSignatureMapStore.value;
    if (!capturedTempoState || !capturedTimeSignatureState) {
        return null;
    }

    const validatedPlan = validateRestorePlan(plan);
    if (
        !validatedPlan ||
        !statesMatchReferenceAndValue(capturedTempoState, capturedTimeSignatureState, validatedPlan.plan.expected)
    ) {
        return null;
    }

    const tempoHasChanges = !timelineMapTimeStateCodec.tempoSnapshotsEqual(
        validatedPlan.plan.expected.tempo,
        validatedPlan.plan.replacement.tempo
    );
    const timeSignatureHasChanges = !timelineMapTimeStateCodec.timeSignatureSnapshotsEqual(
        validatedPlan.plan.expected.timeSignature,
        validatedPlan.plan.replacement.timeSignature
    );
    let replacementTempoState = validatedPlan.replacementState.tempoState;
    if (!tempoHasChanges) {
        replacementTempoState = capturedTempoState;
    }
    let replacementTimeSignatureState = validatedPlan.replacementState.timeSignatureState;
    if (!timeSignatureHasChanges) {
        replacementTimeSignatureState = capturedTimeSignatureState;
    }

    return {
        capturedTempoState,
        capturedTimeSignatureState,
        expectedSnapshot: validatedPlan.plan.expected,
        replacementTempoState,
        replacementTimeSignatureState,
        replacementSnapshot: validatedPlan.plan.replacement,
        tempoHasChanges,
        timeSignatureHasChanges,
        hasChanges: tempoHasChanges || timeSignatureHasChanges,
    };
}

function prepareRestoreState(plan: unknown): PreparedRestoreState | null {
    try {
        return prepareRestoreStateUnchecked(plan);
    } catch {
        return null;
    }
}

function publishTempoState(state: TempoMapStoreState): void {
    tempoMapStore.set(state);
    if (tempoMapStore.value !== state) {
        throw new Error('Tempo map store did not publish the expected state');
    }
}

function publishTimeSignatureState(state: TimeSignatureMapStoreState): void {
    timeSignatureMapStore.set(state);
    if (timeSignatureMapStore.value !== state) {
        throw new Error('Time-signature map store did not publish the expected state');
    }
}

function restoreCompleteState(
    tempoState: TempoMapStoreState,
    timeSignatureState: TimeSignatureMapStoreState
): unknown[] {
    const failures: unknown[] = [];

    if (timeSignatureMapStore.value !== timeSignatureState) {
        try {
            publishTimeSignatureState(timeSignatureState);
        } catch (error) {
            failures.push(error);
        }
    }

    if (tempoMapStore.value !== tempoState) {
        try {
            publishTempoState(tempoState);
        } catch (error) {
            failures.push(error);
        }
    }

    return failures;
}

function collapseCompensationFailures(failures: unknown[]): unknown {
    if (failures.length === 1) {
        return failures[0];
    }
    return new AggregateError(failures, 'Multiple timeline map compensation writes failed');
}

function publishTimelineMapStates({
    tempoState,
    timeSignatureState,
    publishTempo,
    publishTimeSignature,
    compensationTempoState,
    compensationTimeSignatureState,
}: PublishTimelineMapStatesInput): void {
    batchStoreUpdates(() => {
        try {
            if (publishTempo) {
                publishTempoState(tempoState);
            }
            if (publishTimeSignature) {
                publishTimeSignatureState(timeSignatureState);
            }
        } catch (error) {
            const publicationFailure = error;
            const compensationFailures = restoreCompleteState(compensationTempoState, compensationTimeSignatureState);
            if (compensationFailures.length > 0) {
                throw new UnrecoveredTimelineMapStateError(
                    publicationFailure,
                    collapseCompensationFailures(compensationFailures)
                );
            }
            throw publicationFailure;
        }
    });
}

export function prepareTimelineMapStateRestore(plan: unknown) {
    const preparedRestore = prepareRestoreState(plan);
    let status: 'ready' | 'rejected' = 'rejected';
    let hasChanges = false;
    let phase: TransactionPhase = 'closed';
    if (preparedRestore) {
        status = 'ready';
        hasChanges = preparedRestore.hasChanges;
        if (hasChanges) {
            phase = 'prepared';
        }
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared' || !preparedRestore || !preparedRestore.hasChanges) {
            phase = 'closed';
            return false;
        }
        if (
            !statesMatchReferenceAndValue(
                preparedRestore.capturedTempoState,
                preparedRestore.capturedTimeSignatureState,
                preparedRestore.expectedSnapshot
            ) ||
            !timelineMapTimeStateCodec.stateMatchesSnapshot({
                tempoState: preparedRestore.replacementTempoState,
                timeSignatureState: preparedRestore.replacementTimeSignatureState,
                snapshot: preparedRestore.replacementSnapshot,
            })
        ) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            publishTimelineMapStates({
                tempoState: preparedRestore.replacementTempoState,
                timeSignatureState: preparedRestore.replacementTimeSignatureState,
                publishTempo: preparedRestore.tempoHasChanges,
                publishTimeSignature: preparedRestore.timeSignatureHasChanges,
                compensationTempoState: preparedRestore.capturedTempoState,
                compensationTimeSignatureState: preparedRestore.capturedTimeSignatureState,
            });
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (
            !statesMatchReferenceAndValue(
                preparedRestore.replacementTempoState,
                preparedRestore.replacementTimeSignatureState,
                preparedRestore.replacementSnapshot
            )
        ) {
            phase = 'closed';
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'applied' || !preparedRestore || !preparedRestore.hasChanges) {
            phase = 'closed';
            return false;
        }
        if (
            !statesMatchReferenceAndValue(
                preparedRestore.replacementTempoState,
                preparedRestore.replacementTimeSignatureState,
                preparedRestore.replacementSnapshot
            ) ||
            !timelineMapTimeStateCodec.stateMatchesSnapshot({
                tempoState: preparedRestore.capturedTempoState,
                timeSignatureState: preparedRestore.capturedTimeSignatureState,
                snapshot: preparedRestore.expectedSnapshot,
            })
        ) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            publishTimelineMapStates({
                tempoState: preparedRestore.capturedTempoState,
                timeSignatureState: preparedRestore.capturedTimeSignatureState,
                publishTempo: preparedRestore.tempoHasChanges,
                publishTimeSignature: preparedRestore.timeSignatureHasChanges,
                compensationTempoState: preparedRestore.replacementTempoState,
                compensationTimeSignatureState: preparedRestore.replacementTimeSignatureState,
            });
        } catch (error) {
            phase = 'closed';
            throw error;
        }

        phase = 'closed';
        return statesMatchReferenceAndValue(
            preparedRestore.capturedTempoState,
            preparedRestore.capturedTimeSignatureState,
            preparedRestore.expectedSnapshot
        );
    }

    return {
        status,
        hasChanges,
        apply,
        revert,
    };
}
