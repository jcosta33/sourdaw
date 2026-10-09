import { batchStoreUpdates } from '#/infra/store/createStore';

import { BEAT_EPSILON, createTempoChange, getTempoAtBeat } from '../../models/TempoMap';
import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { tempoMapStore, type TempoChange, type TempoMapStoreState } from '../../stores/tempoMapStore';
import {
    timeSignatureMapStore,
    type TimeSignatureChange,
    type TimeSignatureMapStoreState,
} from '../../stores/timeSignatureMapStore';
import { defaultTransportState, transportStore } from '../../stores/transportStore';

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

type CarriedChanges<TChange extends TimelineChange> = {
    // Land before any change already on their beat.
    arrivals: TChange[];
    // Land after any change already on their beat.
    carried: TChange[];
};

type CarryAcrossDeletion<TChange extends TimelineChange> = (
    input: CarryAcrossDeletionInput<TChange>
) => CarriedChanges<TChange>;

type CarryAcrossInsertionInput<TChange extends TimelineChange> = {
    original: readonly TChange[];
    atBeat: number;
    durationBeats: number;
};

type CarryAcrossInsertion<TChange extends TimelineChange> = (
    input: CarryAcrossInsertionInput<TChange>
) => CarriedChanges<TChange>;

type CarryAcrossTimeOperation<TChange extends TimelineChange> = {
    deletion: CarryAcrossDeletion<TChange>;
    insertion: CarryAcrossInsertion<TChange>;
};

type Ramp = {
    ramping: TempoChange;
    target: TempoChange;
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

// The tolerance decides which side of a bound a change falls on, and nothing
// else: a change within BEAT_EPSILON of a bound is on it. The bounds themselves
// never move, so the span the maps lose is exactly the span the content loses.
function isBeforeCut(beat: number, startBeat: number): boolean {
    return beat < startBeat - BEAT_EPSILON;
}

function isPastCut(beat: number, endBeat: number): boolean {
    return beat >= endBeat - BEAT_EPSILON;
}

// Shifted by exactly the span the content moves by. A beat that lands within
// BEAT_EPSILON of the start is on the cut and goes exactly there, so every
// change on the cut shares the start's beat and none sits a float step off it.
function shiftPastCut(beat: number, startBeat: number, endBeat: number): number {
    const shiftedBeat = beat - (endBeat - startBeat);
    return shiftedBeat - startBeat <= BEAT_EPSILON ? startBeat : shiftedBeat;
}

// Inserting time classifies against the insert point as Delete Time does against
// its bounds: a change before it less BEAT_EPSILON is kept, and every other one
// moves by exactly the inserted span, as content does. A change within
// BEAT_EPSILON of the point is on it and goes exactly to the span end, so every
// change on the point shares that beat and none sits a float step off it.
function isOnInsertPoint(beat: number, atBeat: number): boolean {
    return Math.abs(beat - atBeat) <= BEAT_EPSILON;
}

function shiftPastInsert(beat: number, { atBeat, durationBeats }: InsertTimelineMapTimeOperation): number {
    return isOnInsertPoint(beat, atBeat) ? atBeat + durationBeats : beat + durationBeats;
}

// Exact: once classified, a remaining change is on the cut only by sitting
// exactly on the start, and every other one is more than BEAT_EPSILON from it.
function hasChangeAtBeat(changes: readonly TimelineChange[], beat: number): boolean {
    return changes.some((change) => change.beat === beat);
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

function insertBeforeBeatOrder<TChange extends TimelineChange>(changes: TChange[], inserted: TChange): TChange[] {
    const sameOrFollowingIndex = changes.findIndex((change) => change.beat >= inserted.beat);
    if (sameOrFollowingIndex === -1) {
        return [...changes, inserted];
    }
    return [...changes.slice(0, sameOrFollowingIndex), inserted, ...changes.slice(sameOrFollowingIndex)];
}

// Removing time removes the span and never changes the tempo of what remains,
// so the tempo in force at the span's end must be in force from its start.
// A ramp cut mid-way carries the value reached at the end and keeps its curve,
// so the rest of the ramp keeps its slope.
function firstChange<TChange extends TimelineChange>(changes: readonly TChange[]): TChange | undefined {
    let first: TChange | undefined;
    for (const change of changes) {
        if (!first || change.beat < first.beat) {
            first = change;
        }
    }
    return first;
}

// A value read at the start only holds where the map is steady there: a linear
// change with a later change to ramp toward is still moving, so one matching
// sample says nothing about the beats that follow.
function isTempoSteadyAt(remaining: readonly TempoChange[], beat: number): boolean {
    const governing = lastChangeAtOrBefore(remaining, beat);
    return !governing || governing.curve === 'instant' || !remaining.some((change) => change.beat > beat);
}

function carryTempoToSpanStart(input: CarryAcrossDeletionInput<TempoChange>): TempoChange | null {
    if (hasChangeAtBeat(input.remaining, input.startBeat)) {
        return null;
    }
    return carryTempoValueToSpanStart(input);
}

function carryTempoValueToSpanStart({
    original,
    remaining,
    startBeat,
    endBeat,
}: CarryAcrossDeletionInput<TempoChange>): TempoChange | null {
    const governingAtEnd = lastChangeAtOrBefore(original, endBeat);
    if (!governingAtEnd) {
        return null;
    }
    const tempoAtEnd = getTempoAtBeat(original, endBeat, governingAtEnd.tempo);
    const rampStartsInsideSpan = governingAtEnd.curve === 'linear' && !isBeforeCut(governingAtEnd.beat, startBeat);
    const rampContinuesPastEnd = original.some((change) => change.beat > endBeat);
    // A ramp that begins inside the span and is still in motion at its end only
    // survives as a ramp when the carried change keeps it, even where the value
    // happens to match: without it the remaining map reads flat up to the next change.
    const carriesRamp = rampStartsInsideSpan && rampContinuesPastEnd;
    const holdsAtStart =
        remaining.length > 0 &&
        isTempoSteadyAt(remaining, startBeat) &&
        getTempoAtBeat(remaining, startBeat, tempoAtEnd) === tempoAtEnd;
    if (!carriesRamp && holdsAtStart) {
        return null;
    }
    return createTempoChange(startBeat, tempoAtEnd, governingAtEnd.curve);
}

// Before its first change a tempo map reads that change's tempo. When the span
// removes the first change and nothing remains before the span, the beats ahead
// of it would fall back to whatever now comes first, so the old first tempo is
// kept at beat 0.
function keepLeadInTempo(
    { original, remaining, startBeat, endBeat }: CarryAcrossDeletionInput<TempoChange>,
    carried: TempoChange | null
): TempoChange | null {
    const oldFirst = firstChange(original);
    if (
        startBeat <= 0 ||
        !oldFirst ||
        isBeforeCut(oldFirst.beat, startBeat) ||
        isPastCut(oldFirst.beat, endBeat) ||
        remaining.some((change) => change.beat < startBeat)
    ) {
        return null;
    }
    const newFirst = firstChange(carried ? [...remaining, carried] : remaining);
    if (newFirst?.tempo === oldFirst.tempo) {
        return null;
    }
    return createTempoChange(0, oldFirst.tempo, 'instant');
}

// The tempo a ramp that is under way at the span start has reached there, read
// along the slope it already has: the last change before the span, when it is
// linear and has a change to ramp toward. Null when nothing ramps into the span.
// A target within tolerance below the start is on the cut and removed with it,
// so the ramp is read along its line up to the start rather than held at the
// target's tempo, which would re-aim the ramp before the cut.
function readRampReachedAtSpanStart(original: readonly TempoChange[], startBeat: number): number | null {
    const ramp = findRampInto(original, startBeat);
    return ramp ? readRampValueAt(ramp, startBeat) : null;
}

// The last change kept before a bound, when it is linear, and the first change
// after it, which it ramps toward ("arrive at the first, govern from the last").
function findRampInto(original: readonly TempoChange[], bound: number): Ramp | null {
    let ramping: TempoChange | undefined;
    for (const change of original) {
        if (isBeforeCut(change.beat, bound) && (!ramping || change.beat >= ramping.beat)) {
            ramping = change;
        }
    }
    if (!ramping || ramping.curve !== 'linear') {
        return null;
    }
    let target: TempoChange | undefined;
    for (const change of original) {
        if (change.beat > ramping.beat && (!target || change.beat < target.beat)) {
            target = change;
        }
    }
    return target ? { ramping, target } : null;
}

function readRampValueAt({ ramping, target }: Ramp, beat: number): number {
    const progress = (beat - ramping.beat) / (target.beat - ramping.beat);
    return ramping.tempo + (target.tempo - ramping.tempo) * progress;
}

// Inserting time never changes the tempo before the insert point, and the
// inserted span holds the tempo in force there. A ramp under way at the point
// would otherwise be re-aimed at its target's shifted beat and run more slowly
// before it, so it arrives at the point on its own slope, at an instant change
// holding the value it reached. A target past the point is resumed from the span
// end by a linear change holding that value, so the rest of the ramp keeps its
// slope; a target on the point moves to the span end itself and governs from there.
function carryTempoAcrossInsertion({
    original,
    atBeat,
    durationBeats,
}: CarryAcrossInsertionInput<TempoChange>): CarriedChanges<TempoChange> {
    const endBeat = atBeat + durationBeats;
    const ramp = findRampInto(original, atBeat);
    if (endBeat === atBeat || !ramp || ramp.ramping.tempo === ramp.target.tempo) {
        return { arrivals: [], carried: [] };
    }
    const reached = readRampValueAt(ramp, atBeat);
    const arrival = createTempoChange(atBeat, reached, 'instant');
    if (isOnInsertPoint(ramp.target.beat, atBeat)) {
        return { arrivals: [arrival], carried: [] };
    }
    return { arrivals: [arrival], carried: [createTempoChange(endBeat, reached, 'linear')] };
}

function carryNothingAcrossInsertion<TChange extends TimelineChange>(): CarriedChanges<TChange> {
    return { arrivals: [], carried: [] };
}

// Removing time never changes the tempo before the cut. A ramp that crosses the
// cut would otherwise be re-aimed at whatever now follows it, so it arrives at
// the cut on its own slope, at an instant change holding the value it reached,
// and the tempo steps there to the one carried from the span end.
function arriveAtSpanStart(
    input: CarryAcrossDeletionInput<TempoChange>,
    carried: TempoChange | null
): TempoChange | null {
    const reached = readRampReachedAtSpanStart(input.original, input.startBeat);
    if (reached === null) {
        return null;
    }
    const firstAtStart = carried ?? input.remaining.find((change) => change.beat === input.startBeat);
    if (firstAtStart?.tempo === reached) {
        return null;
    }
    return createTempoChange(input.startBeat, reached, 'instant');
}

function carryTempoAcrossDeletion(input: CarryAcrossDeletionInput<TempoChange>): CarriedChanges<TempoChange> {
    const provisional = carryTempoToSpanStart(input);
    const leadIn = keepLeadInTempo(input, provisional);
    if (leadIn) {
        // The lead-in tempo now reads at the span start, so whether the start already
        // holds the tempo in force at the span end is decided on the map that has it.
        const carried = carryTempoToSpanStart({ ...input, remaining: [...input.remaining, leadIn] });
        return { arrivals: [], carried: carried ? [leadIn, carried] : [leadIn] };
    }
    const arrival = arriveAtSpanStart(input, provisional);
    if (!arrival) {
        return { arrivals: [], carried: provisional ? [provisional] : [] };
    }
    // The arrival now reads at the span start, so whether the start already
    // holds the tempo in force at the span end is decided on the map that has it.
    if (hasChangeAtBeat(input.remaining, input.startBeat)) {
        return { arrivals: [arrival], carried: [] };
    }
    const carried = carryTempoValueToSpanStart({ ...input, remaining: [...input.remaining, arrival] });
    return { arrivals: [arrival], carried: carried ? [carried] : [] };
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
// downbeat of the governing meter falls before the next change. A downbeat that
// lands on the next change has no successor to use: the change that is already
// there opens its own bar, and a later downbeat of this meter would sit past it.
function findShiftedDownbeat(
    governing: TimeSignatureChange,
    { original, startBeat, endBeat }: CarryAcrossDeletionInput<TimeSignatureChange>
): number | null {
    const barBeats = meterBarBeats(governing);
    const nextChange = Math.min(
        Infinity,
        ...original.filter((change) => change.beat > endBeat).map(({ beat }) => beat)
    );
    const downbeat = governing.beat + Math.ceil((endBeat - governing.beat - BEAT_EPSILON) / barBeats) * barBeats;
    if (downbeat >= nextChange - BEAT_EPSILON) {
        return null;
    }
    return shiftPastCut(downbeat, startBeat, endBeat);
}

// With no explicit change at or before the span end the project's own meter
// governs from beat 0, and it is carried like any other.
function readImpliedTimeSignature(): TimeSignatureChange {
    return {
        id: 'implied-time-signature',
        beat: 0,
        numerator: transportStore.value?.timeSignatureNumerator ?? defaultTransportState.timeSignatureNumerator,
        denominator: transportStore.value?.timeSignatureDenominator ?? defaultTransportState.timeSignatureDenominator,
    };
}

function carryTimeSignatureAcrossDeletion(
    input: CarryAcrossDeletionInput<TimeSignatureChange>
): CarriedChanges<TimeSignatureChange> {
    return { arrivals: [], carried: carryTimeSignatureToSpanStart(input) };
}

function carryTimeSignatureToSpanStart(input: CarryAcrossDeletionInput<TimeSignatureChange>): TimeSignatureChange[] {
    const { original, remaining, startBeat, endBeat } = input;
    if (hasChangeAtBeat(remaining, startBeat)) {
        return [];
    }
    const explicitAtEnd = lastChangeAtOrBefore(original, endBeat);
    const implied = readImpliedTimeSignature();
    const impliedAtStart = explicitAtEnd ? undefined : implied;
    const governingAtEnd = explicitAtEnd ?? implied;
    const shiftedDownbeat = findShiftedDownbeat(governingAtEnd, input);
    const carriedBeat = shiftedDownbeat ?? startBeat;
    const governingAtCarriedBeat = lastChangeAtOrBefore(remaining, carriedBeat) ?? impliedAtStart;
    if (
        governingAtCarriedBeat &&
        governingAtCarriedBeat.numerator === governingAtEnd.numerator &&
        governingAtCarriedBeat.denominator === governingAtEnd.denominator &&
        (shiftedDownbeat === null || isMeterBarStart(governingAtCarriedBeat, carriedBeat))
    ) {
        return [];
    }
    return [createTimeSignatureChange(carriedBeat, governingAtEnd.numerator, governingAtEnd.denominator)];
}

function prepareDeletedChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: DeleteTimelineMapTimeOperation,
    carryAcrossDeletion: CarryAcrossDeletion<TChange>
): PreparedChanges<TChange> {
    const { startBeat, endBeat } = operation;
    if (endBeat <= startBeat) {
        return { status: 'valid', hasChanges: false, changes: [...changes] };
    }
    let hasChanges = false;
    const remainingChanges: TChange[] = [];

    for (const change of changes) {
        if (isBeforeCut(change.beat, startBeat)) {
            remainingChanges.push(change);
            continue;
        }
        if (!isPastCut(change.beat, endBeat)) {
            hasChanges = true;
            continue;
        }

        const shiftedBeat = shiftPastCut(change.beat, startBeat, endBeat);
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

    const carriedChanges = carryAcrossDeletion({
        original: changes,
        remaining: remainingChanges,
        startBeat,
        endBeat,
    });
    return placeCarriedChanges(remainingChanges, hasChanges, carriedChanges);
}

function prepareInsertedChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: InsertTimelineMapTimeOperation,
    carryAcrossInsertion: CarryAcrossInsertion<TChange>
): PreparedChanges<TChange> {
    let hasChanges = false;
    const nextChanges: TChange[] = [];

    for (const change of changes) {
        if (isBeforeCut(change.beat, operation.atBeat)) {
            nextChanges.push(change);
            continue;
        }

        const shiftedBeat = shiftPastInsert(change.beat, operation);
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

    const carriedChanges = carryAcrossInsertion({ original: changes, ...operation });
    return placeCarriedChanges(nextChanges, hasChanges, carriedChanges);
}

function placeCarriedChanges<TChange extends TimelineChange>(
    changes: TChange[],
    hasChanges: boolean,
    { arrivals, carried }: CarriedChanges<TChange>
): PreparedChanges<TChange> {
    if (arrivals.length === 0 && carried.length === 0) {
        return { status: 'valid', hasChanges, changes };
    }

    const withArrivals = arrivals.reduce((ordered, change) => insertBeforeBeatOrder(ordered, change), changes);
    return {
        status: 'valid',
        hasChanges: true,
        changes: carried.reduce((ordered, change) => insertAtBeatOrder(ordered, change), withArrivals),
    };
}

function prepareChanges<TChange extends TimelineChange>(
    changes: readonly TChange[],
    operation: TimelineMapTimeOperation,
    carryAcross: CarryAcrossTimeOperation<TChange>
): PreparedChanges<TChange> {
    if (operation.type === 'insert') {
        return prepareInsertedChanges(changes, operation, carryAcross.insertion);
    }
    return prepareDeletedChanges(changes, operation, carryAcross.deletion);
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

    const preparedTempoChanges = prepareChanges(tempoState.changes, operation, {
        deletion: carryTempoAcrossDeletion,
        insertion: carryTempoAcrossInsertion,
    });
    if (preparedTempoChanges.status === 'invalid') {
        return { status: 'rejected' };
    }

    const preparedTimeSignatureChanges = prepareChanges(timeSignatureState.changes, operation, {
        deletion: carryTimeSignatureAcrossDeletion,
        insertion: carryNothingAcrossInsertion,
    });
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
