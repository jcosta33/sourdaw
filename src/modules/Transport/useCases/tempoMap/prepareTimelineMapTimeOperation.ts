import { batchStoreUpdates } from '#/infra/store/createStore';

import { tempoMapStore, type TempoMapStoreState } from '../../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../../stores/timeSignatureMapStore';

import { timelineMapTimeStateCodec } from './timelineMapTimeStateCodec';

type InsertTimelineMapTimeOperation = {
    type: 'insert';
    atBeat: number;
    durationBeats: number;
};

type DeleteTimelineMapTimeOperation = {
    type: 'delete';
    startBeat: number;
    endBeat: number;
};

type TimelineMapTimeOperation = InsertTimelineMapTimeOperation | DeleteTimelineMapTimeOperation;

type PrepareTimelineMapTimeOperationInput = {
    operation: TimelineMapTimeOperation;
};

type TimelineChange = {
    beat: number;
};

type PreparedChanges<TChange extends TimelineChange> =
    | { status: 'invalid' }
    | {
          status: 'valid';
          hasChanges: boolean;
          changes: TChange[];
      };

type ReadyTimelineMapStates = {
    status: 'ready';
    hasChanges: boolean;
    tempoHasChanges: boolean;
    timeSignatureHasChanges: boolean;
    tempoState: TempoMapStoreState;
    timeSignatureState: TimeSignatureMapStoreState;
    capturedSnapshot: TimelineMapTimeStateSnapshot;
    nextTempoState: TempoMapStoreState;
    nextTimeSignatureState: TimeSignatureMapStoreState;
};

type PreparedTimelineMapStates = { status: 'rejected' } | ReadyTimelineMapStates;

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

type TimelineMapTimeStateSnapshot = NonNullable<ReturnType<typeof timelineMapTimeStateCodec.encodeState>>;

type TimelineMapTimeStateRestorePlan = {
    version: 1;
    expected: TimelineMapTimeStateSnapshot;
    replacement: TimelineMapTimeStateSnapshot;
};

type PreparedStateSnapshots = {
    captured: TimelineMapTimeStateSnapshot;
    next: TimelineMapTimeStateSnapshot;
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

function isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function isValidOperation(operation: TimelineMapTimeOperation): boolean {
    if (operation.type === 'insert') {
        if (
            !isFiniteNonNegative(operation.atBeat) ||
            !Number.isFinite(operation.durationBeats) ||
            operation.durationBeats <= 0
        ) {
            return false;
        }

        const endBeat = operation.atBeat + operation.durationBeats;
        return Number.isFinite(endBeat);
    }

    return (
        isFiniteNonNegative(operation.startBeat) &&
        Number.isFinite(operation.endBeat) &&
        operation.endBeat > operation.startBeat
    );
}

function prepareInsertedChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: InsertTimelineMapTimeOperation
): PreparedChanges<TChange> {
    let hasChanges = false;
    const nextChanges: TChange[] = [];

    for (const change of changes) {
        if (change.beat < operation.atBeat) {
            nextChanges.push(change);
            continue;
        }

        const shiftedBeat = change.beat + operation.durationBeats;
        if (!isFiniteNonNegative(shiftedBeat)) {
            return { status: 'invalid' };
        }
        if (shiftedBeat === change.beat) {
            nextChanges.push(change);
            continue;
        }

        hasChanges = true;
        nextChanges.push({ ...change, beat: shiftedBeat });
    }

    return {
        status: 'valid',
        hasChanges,
        changes: nextChanges,
    };
}

function prepareDeletedChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: DeleteTimelineMapTimeOperation
): PreparedChanges<TChange> {
    const durationBeats = operation.endBeat - operation.startBeat;
    let hasChanges = false;
    const nextChanges: TChange[] = [];

    for (const change of changes) {
        if (change.beat >= operation.startBeat && change.beat < operation.endBeat) {
            hasChanges = true;
            continue;
        }
        if (change.beat < operation.endBeat) {
            nextChanges.push(change);
            continue;
        }

        const shiftedBeat = change.beat - durationBeats;
        if (!isFiniteNonNegative(shiftedBeat)) {
            return { status: 'invalid' };
        }
        if (shiftedBeat === change.beat) {
            nextChanges.push(change);
            continue;
        }

        hasChanges = true;
        nextChanges.push({ ...change, beat: shiftedBeat });
    }

    return {
        status: 'valid',
        hasChanges,
        changes: nextChanges,
    };
}

function prepareChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: TimelineMapTimeOperation
): PreparedChanges<TChange> {
    if (operation.type === 'insert') {
        return prepareInsertedChanges(changes, operation);
    }
    return prepareDeletedChanges(changes, operation);
}

function prepareTimelineMapStates(operation: TimelineMapTimeOperation): PreparedTimelineMapStates {
    const tempoState = tempoMapStore.value;
    const timeSignatureState = timeSignatureMapStore.value;
    if (!tempoState || !timeSignatureState || !isValidOperation(operation)) {
        return { status: 'rejected' };
    }

    const capturedSnapshot = timelineMapTimeStateCodec.encodeState({ tempoState, timeSignatureState });
    if (!capturedSnapshot) {
        return { status: 'rejected' };
    }

    const preparedTempoChanges = prepareChanges(tempoState.changes, operation);
    if (preparedTempoChanges.status === 'invalid') {
        return { status: 'rejected' };
    }

    const preparedTimeSignatureChanges = prepareChanges(timeSignatureState.changes, operation);
    if (preparedTimeSignatureChanges.status === 'invalid') {
        return { status: 'rejected' };
    }

    let nextTempoState = tempoState;
    if (preparedTempoChanges.hasChanges) {
        nextTempoState = {
            ...tempoState,
            changes: preparedTempoChanges.changes,
        };
    }

    let nextTimeSignatureState = timeSignatureState;
    if (preparedTimeSignatureChanges.hasChanges) {
        nextTimeSignatureState = {
            ...timeSignatureState,
            changes: preparedTimeSignatureChanges.changes,
        };
    }

    return {
        status: 'ready',
        hasChanges: preparedTempoChanges.hasChanges || preparedTimeSignatureChanges.hasChanges,
        tempoHasChanges: preparedTempoChanges.hasChanges,
        timeSignatureHasChanges: preparedTimeSignatureChanges.hasChanges,
        tempoState,
        timeSignatureState,
        capturedSnapshot,
        nextTempoState,
        nextTimeSignatureState,
    };
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

function storesMatch(tempoState: TempoMapStoreState, timeSignatureState: TimeSignatureMapStoreState): boolean {
    return tempoMapStore.value === tempoState && timeSignatureMapStore.value === timeSignatureState;
}

function createStateSnapshots(preparedStates: ReadyTimelineMapStates): PreparedStateSnapshots | null {
    const next = timelineMapTimeStateCodec.encodeState({
        tempoState: preparedStates.nextTempoState,
        timeSignatureState: preparedStates.nextTimeSignatureState,
    });
    if (!next) {
        return null;
    }
    return { captured: preparedStates.capturedSnapshot, next };
}

function createInversePlan(snapshots: PreparedStateSnapshots): TimelineMapTimeStateRestorePlan {
    return {
        version: 1,
        expected: structuredClone(snapshots.next),
        replacement: structuredClone(snapshots.captured),
    };
}

function storesMatchReferenceAndValue(
    tempoState: TempoMapStoreState,
    timeSignatureState: TimeSignatureMapStoreState,
    snapshot: TimelineMapTimeStateSnapshot
): boolean {
    if (!storesMatch(tempoState, timeSignatureState)) {
        return false;
    }
    return timelineMapTimeStateCodec.stateMatchesSnapshot({
        tempoState,
        timeSignatureState,
        snapshot,
    });
}

export function prepareTimelineMapTimeOperation({ operation }: PrepareTimelineMapTimeOperationInput) {
    let preparedStates: PreparedTimelineMapStates = prepareTimelineMapStates(operation);
    let preparedSnapshots: PreparedStateSnapshots | null = null;
    let inversePlan: TimelineMapTimeStateRestorePlan | null = null;
    if (preparedStates.status === 'ready') {
        preparedSnapshots = createStateSnapshots(preparedStates);
        if (!preparedSnapshots) {
            preparedStates = { status: 'rejected' };
        } else if (preparedStates.hasChanges) {
            inversePlan = createInversePlan(preparedSnapshots);
        }
    }

    const hasChanges = preparedStates.status === 'ready' && preparedStates.hasChanges;
    let phase: TransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared' || preparedStates.status !== 'ready' || !preparedSnapshots) {
            return false;
        }
        if (
            !storesMatchReferenceAndValue(
                preparedStates.tempoState,
                preparedStates.timeSignatureState,
                preparedSnapshots.captured
            ) ||
            !timelineMapTimeStateCodec.stateMatchesSnapshot({
                tempoState: preparedStates.nextTempoState,
                timeSignatureState: preparedStates.nextTimeSignatureState,
                snapshot: preparedSnapshots.next,
            })
        ) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            publishTimelineMapStates({
                tempoState: preparedStates.nextTempoState,
                timeSignatureState: preparedStates.nextTimeSignatureState,
                publishTempo: preparedStates.tempoHasChanges,
                publishTimeSignature: preparedStates.timeSignatureHasChanges,
                compensationTempoState: preparedStates.tempoState,
                compensationTimeSignatureState: preparedStates.timeSignatureState,
            });
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (
            !storesMatchReferenceAndValue(
                preparedStates.nextTempoState,
                preparedStates.nextTimeSignatureState,
                preparedSnapshots.next
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
        if (phase !== 'applied' || preparedStates.status !== 'ready' || !preparedSnapshots) {
            return false;
        }
        if (
            !storesMatchReferenceAndValue(
                preparedStates.nextTempoState,
                preparedStates.nextTimeSignatureState,
                preparedSnapshots.next
            ) ||
            !timelineMapTimeStateCodec.stateMatchesSnapshot({
                tempoState: preparedStates.tempoState,
                timeSignatureState: preparedStates.timeSignatureState,
                snapshot: preparedSnapshots.captured,
            })
        ) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            publishTimelineMapStates({
                tempoState: preparedStates.tempoState,
                timeSignatureState: preparedStates.timeSignatureState,
                publishTempo: preparedStates.tempoHasChanges,
                publishTimeSignature: preparedStates.timeSignatureHasChanges,
                compensationTempoState: preparedStates.nextTempoState,
                compensationTimeSignatureState: preparedStates.nextTimeSignatureState,
            });
        } catch (error) {
            phase = 'closed';
            throw error;
        }

        phase = 'closed';
        return storesMatchReferenceAndValue(
            preparedStates.tempoState,
            preparedStates.timeSignatureState,
            preparedSnapshots.captured
        );
    }

    return {
        status: preparedStates.status,
        hasChanges,
        inversePlan,
        apply,
        revert,
    };
}
