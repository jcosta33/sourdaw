import { batchStoreUpdates } from '#/infra/store/createStore';

import { BEAT_EPSILON, createTempoChange, getTempoAtBeat } from '../../models/TempoMap';
import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { tempoMapStore, type TempoChange, type TempoMapStoreState } from '../../stores/tempoMapStore';
import {
    timeSignatureMapStore,
    type TimeSignatureChange,
    type TimeSignatureMapStoreState,
} from '../../stores/timeSignatureMapStore';

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

type CarryAcrossDeletionInput<TChange extends TimelineChange> = {
    original: readonly TChange[];
    remaining: readonly TChange[];
    startBeat: number;
    endBeat: number;
};

type CarryAcrossDeletion<TChange extends TimelineChange> = (input: CarryAcrossDeletionInput<TChange>) => TChange | null;

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

function hasChangeAtBeat(changes: readonly TimelineChange[], beat: number): boolean {
    return changes.some((change) => Math.abs(change.beat - beat) <= BEAT_EPSILON);
}

// The later entry wins a tie, as the sorted view the map readers use does.
function lastChangeAtOrBefore<TChange extends TimelineChange>(
    changes: readonly TChange[],
    beat: number
): TChange | undefined {
    let governing: TChange | undefined;
    for (const change of changes) {
        if (change.beat <= beat && (!governing || change.beat >= governing.beat)) {
            governing = change;
        }
    }
    return governing;
}

function insertAtBeatOrder<TChange extends TimelineChange>(changes: TChange[], inserted: TChange): TChange[] {
    const followingIndex = changes.findIndex((change) => change.beat > inserted.beat);
    if (followingIndex === -1) {
        return [...changes, inserted];
    }
    return [...changes.slice(0, followingIndex), inserted, ...changes.slice(followingIndex)];
}

// Removing time removes the span and never changes the tempo of what remains,
// so the tempo in force at the span's end must be in force from its start.
// A ramp cut mid-way carries the value reached at the end and keeps its curve,
// so the rest of the ramp keeps its slope.
function carryTempoAcrossDeletion({ original, remaining, startBeat, endBeat }: CarryAcrossDeletionInput<TempoChange>) {
    if (hasChangeAtBeat(remaining, startBeat)) {
        return null;
    }
    const governingAtEnd = lastChangeAtOrBefore(original, endBeat);
    if (!governingAtEnd) {
        return null;
    }
    const tempoAtEnd = getTempoAtBeat(original, endBeat, governingAtEnd.tempo);
    const rampStartsInsideSpan = governingAtEnd.curve === 'linear' && governingAtEnd.beat >= startBeat;
    const rampContinuesPastEnd = original.some((change) => change.beat > endBeat);
    // A ramp that begins inside the span and is still in motion at its end only
    // survives as a ramp when the carried change keeps it, even where the value
    // happens to match: without it the remaining map reads flat up to the next change.
    const carriesRamp = rampStartsInsideSpan && rampContinuesPastEnd;
    if (!carriesRamp && remaining.length > 0 && getTempoAtBeat(remaining, startBeat, tempoAtEnd) === tempoAtEnd) {
        return null;
    }
    return createTempoChange(startBeat, tempoAtEnd, governingAtEnd.curve);
}

function meterBarBeats(change: TimeSignatureChange): number {
    return (change.numerator * 4) / change.denominator;
}

function isMeterBarStart(change: TimeSignatureChange, beat: number): boolean {
    const bars = (beat - change.beat) / meterBarBeats(change);
    return Math.abs(bars - Math.round(bars)) * meterBarBeats(change) <= BEAT_EPSILON;
}

// Bars are counted from the change that opens them, so material after the cut
// keeps its bar positions only if the carried meter opens where an old downbeat
// of the governing meter lands once the span is gone. Between the span start and
// that beat the meter before the span continues, as a partial bar. Null when no
// downbeat of the governing meter falls before the next change.
function findShiftedDownbeat(
    governing: TimeSignatureChange,
    { original, remaining, startBeat, endBeat }: CarryAcrossDeletionInput<TimeSignatureChange>
): number | null {
    const barBeats = meterBarBeats(governing);
    const nextChange = Math.min(
        Infinity,
        ...original.filter((change) => change.beat > endBeat).map(({ beat }) => beat)
    );
    let downbeat = governing.beat + Math.ceil((endBeat - governing.beat - BEAT_EPSILON) / barBeats) * barBeats;
    while (downbeat < nextChange - BEAT_EPSILON) {
        const shifted = downbeat - (endBeat - startBeat);
        if (shifted >= startBeat - BEAT_EPSILON && !hasChangeAtBeat(remaining, shifted)) {
            return Math.max(shifted, startBeat);
        }
        downbeat += barBeats;
    }
    return null;
}

function carryTimeSignatureAcrossDeletion(input: CarryAcrossDeletionInput<TimeSignatureChange>) {
    const { original, remaining, startBeat, endBeat } = input;
    if (hasChangeAtBeat(remaining, startBeat)) {
        return null;
    }
    const governingAtEnd = lastChangeAtOrBefore(original, endBeat);
    if (!governingAtEnd) {
        return null;
    }
    const shiftedDownbeat = findShiftedDownbeat(governingAtEnd, input);
    const carriedBeat = shiftedDownbeat ?? startBeat;
    const governingAtCarriedBeat = lastChangeAtOrBefore(remaining, carriedBeat);
    if (
        governingAtCarriedBeat &&
        governingAtCarriedBeat.numerator === governingAtEnd.numerator &&
        governingAtCarriedBeat.denominator === governingAtEnd.denominator &&
        (shiftedDownbeat === null || isMeterBarStart(governingAtCarriedBeat, carriedBeat))
    ) {
        return null;
    }
    return createTimeSignatureChange(carriedBeat, governingAtEnd.numerator, governingAtEnd.denominator);
}

function prepareDeletedChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: DeleteTimelineMapTimeOperation,
    carryAcrossDeletion: CarryAcrossDeletion<TChange>
): PreparedChanges<TChange> {
    const durationBeats = operation.endBeat - operation.startBeat;
    let hasChanges = false;
    const remainingChanges: TChange[] = [];

    for (const change of changes) {
        if (change.beat >= operation.startBeat && change.beat < operation.endBeat) {
            hasChanges = true;
            continue;
        }
        if (change.beat < operation.endBeat) {
            remainingChanges.push(change);
            continue;
        }

        const shiftedBeat = change.beat - durationBeats;
        if (!isFiniteNonNegative(shiftedBeat)) {
            return { status: 'invalid' };
        }
        if (shiftedBeat === change.beat) {
            remainingChanges.push(change);
            continue;
        }

        hasChanges = true;
        remainingChanges.push({ ...change, beat: shiftedBeat });
    }

    const carried = carryAcrossDeletion({
        original: changes,
        remaining: remainingChanges,
        startBeat: operation.startBeat,
        endBeat: operation.endBeat,
    });
    if (!carried) {
        return { status: 'valid', hasChanges, changes: remainingChanges };
    }

    return {
        status: 'valid',
        hasChanges: true,
        changes: insertAtBeatOrder(remainingChanges, carried),
    };
}

function prepareChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: TimelineMapTimeOperation,
    carryAcrossDeletion: CarryAcrossDeletion<TChange>
): PreparedChanges<TChange> {
    if (operation.type === 'insert') {
        return prepareInsertedChanges(changes, operation);
    }
    return prepareDeletedChanges(changes, operation, carryAcrossDeletion);
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

    const preparedTempoChanges = prepareChanges(tempoState.changes, operation, carryTempoAcrossDeletion);
    if (preparedTempoChanges.status === 'invalid') {
        return { status: 'rejected' };
    }

    const preparedTimeSignatureChanges = prepareChanges(
        timeSignatureState.changes,
        operation,
        carryTimeSignatureAcrossDeletion
    );
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
