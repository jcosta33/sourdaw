import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TempoChange, TempoMapStoreState } from '../../../stores/tempoMapStore';
import type { TimeSignatureChange, TimeSignatureMapStoreState } from '../../../stores/timeSignatureMapStore';

vi.mock('../../../stores/tempoMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/tempoMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');

    return { ...actual, tempoMapStore: createStore() };
});

vi.mock('../../../stores/timeSignatureMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/timeSignatureMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');

    return { ...actual, timeSignatureMapStore: createStore() };
});

const { tempoMapStore } = await import('../../../stores/tempoMapStore');
const { timeSignatureMapStore } = await import('../../../stores/timeSignatureMapStore');
const { prepareTimelineMapTimeOperation } = await import('../prepareTimelineMapTimeOperation');

type PrepareInput = Parameters<typeof prepareTimelineMapTimeOperation>[0];
type TimelineMapTimeOperation = PrepareInput['operation'];

type StoreObservation = {
    tempo: TempoMapStoreState | null;
    timeSignature: TimeSignatureMapStoreState | null;
};

const unsubscribers: Array<() => void> = [];

function tempoChange(id: string, beat: number, tempo = 120): TempoChange {
    return { id, beat, tempo, curve: 'instant' };
}

function timeSignatureChange(id: string, beat: number, numerator = 4): TimeSignatureChange {
    return { id, beat, numerator, denominator: 4 };
}

function tempoState(changes: TempoChange[]): TempoMapStoreState {
    return { changes };
}

function timeSignatureState(changes: TimeSignatureChange[]): TimeSignatureMapStoreState {
    return { changes };
}

function setStoreStates(tempo: TempoMapStoreState | null, timeSignature: TimeSignatureMapStoreState | null): void {
    tempoMapStore.set(tempo);
    timeSignatureMapStore.set(timeSignature);
}

function observeBothStores(): StoreObservation[] {
    const observations: StoreObservation[] = [];
    function observe(): void {
        observations.push({
            tempo: tempoMapStore.value,
            timeSignature: timeSignatureMapStore.value,
        });
    }

    unsubscribers.push(tempoMapStore.subscribe(observe));
    unsubscribers.push(timeSignatureMapStore.subscribe(observe));
    return observations;
}

function expectClosedWithoutWrite(
    operation: TimelineMapTimeOperation
): ReturnType<typeof prepareTimelineMapTimeOperation> {
    const capturedTempo = tempoMapStore.value;
    const capturedTimeSignature = timeSignatureMapStore.value;
    const tempoSet = vi.spyOn(tempoMapStore, 'set');
    const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

    const transaction = prepareTimelineMapTimeOperation({ operation });

    expect(transaction.hasChanges).toBe(false);
    expect(transaction.inversePlan).toBeNull();
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(tempoMapStore.value).toBe(capturedTempo);
    expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
    expect(tempoSet).not.toHaveBeenCalled();
    expect(timeSignatureSet).not.toHaveBeenCalled();
    return transaction;
}

describe('prepareTimelineMapTimeOperation', () => {
    beforeEach(() => {
        setStoreStates(tempoState([]), timeSignatureState([]));
    });

    afterEach(() => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
        unsubscribers.length = 0;
        vi.restoreAllMocks();
    });

    it('prepares without effects and inserts time into both maps with exact boundary parity', () => {
        const tempoBefore = tempoChange('tempo-before', 3, 110);
        const tempoAt = tempoChange('tempo-at', 4, 120);
        const tempoAfter = tempoChange('tempo-after', 6, 130);
        const signatureBefore = timeSignatureChange('signature-before', 3, 3);
        const signatureAt = timeSignatureChange('signature-at', 4, 5);
        const signatureAfter = timeSignatureChange('signature-after', 6, 7);
        const capturedTempo = tempoState([tempoBefore, tempoAt, tempoAfter]);
        const capturedTimeSignature = timeSignatureState([signatureBefore, signatureAt, signatureAfter]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['tempo-before', 3],
            ['tempo-at', 6],
            ['tempo-after', 8],
        ]);
        expect(timeSignatureMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['signature-before', 3],
            ['signature-at', 6],
            ['signature-after', 8],
        ]);
        expect(tempoMapStore.value?.changes[0]).toBe(tempoBefore);
        expect(tempoMapStore.value?.changes[1]).not.toBe(tempoAt);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signatureBefore);
        expect(timeSignatureMapStore.value?.changes[1]).not.toBe(signatureAt);
        expect(tempoSet).toHaveBeenCalledOnce();
        expect(timeSignatureSet).toHaveBeenCalledOnce();
    });

    it('deletes the characterized half-open range from both maps while preserving order and identity', () => {
        const tempoBefore = tempoChange('tempo-before', 2, 110);
        const tempoEnd = tempoChange('tempo-end', 6, 130);
        const signatureBefore = timeSignatureChange('signature-before', 2, 3);
        const signatureEnd = timeSignatureChange('signature-end', 6, 6);
        setStoreStates(
            tempoState([
                tempoBefore,
                tempoChange('tempo-at', 3),
                tempoChange('tempo-inside', 4, 125),
                tempoEnd,
                tempoChange('tempo-after', 8, 140),
            ]),
            timeSignatureState([
                signatureBefore,
                timeSignatureChange('signature-at', 3),
                timeSignatureChange('signature-inside', 4, 5),
                signatureEnd,
                timeSignatureChange('signature-after', 8, 7),
            ])
        );

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'delete', startBeat: 3, endBeat: 6 },
        });

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['tempo-before', 2],
            ['tempo-end', 3],
            ['tempo-after', 5],
        ]);
        expect(timeSignatureMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['signature-before', 2],
            ['signature-end', 3],
            ['signature-after', 5],
        ]);
        expect(tempoMapStore.value?.changes[0]).toBe(tempoBefore);
        expect(tempoMapStore.value?.changes[1]).not.toBe(tempoEnd);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signatureBefore);
        expect(timeSignatureMapStore.value?.changes[1]).not.toBe(signatureEnd);
    });

    it.each([
        { type: 'insert' as const, atBeat: Number.NaN, durationBeats: 1 },
        { type: 'insert' as const, atBeat: -1, durationBeats: 1 },
        { type: 'insert' as const, atBeat: 0, durationBeats: 0 },
        { type: 'insert' as const, atBeat: 0, durationBeats: Number.POSITIVE_INFINITY },
        { type: 'delete' as const, startBeat: Number.NaN, endBeat: 4 },
        { type: 'delete' as const, startBeat: -1, endBeat: 4 },
        { type: 'delete' as const, startBeat: 4, endBeat: 4 },
        { type: 'delete' as const, startBeat: 5, endBeat: 4 },
        { type: 'delete' as const, startBeat: 0, endBeat: Number.POSITIVE_INFINITY },
    ])('rejects an invalid $type operation before either owner write', (operation) => {
        setStoreStates(
            tempoState([tempoChange('tempo', 4)]),
            timeSignatureState([timeSignatureChange('signature', 4)])
        );

        const transaction = expectClosedWithoutWrite(operation);
        expect(transaction.status).toBe('rejected');
    });

    it.each([
        {
            name: 'empty',
            tempo: tempoState([]),
            timeSignature: timeSignatureState([]),
        },
        {
            name: 'all-before-boundary',
            tempo: tempoState([tempoChange('tempo-before', 4)]),
            timeSignature: timeSignatureState([timeSignatureChange('signature-before', 4)]),
        },
    ])('rejects an overflowing insert endpoint with $name owner maps', ({ tempo, timeSignature }) => {
        setStoreStates(tempo, timeSignature);

        const transaction = expectClosedWithoutWrite({
            type: 'insert',
            atBeat: Number.MAX_VALUE,
            durationBeats: Number.MAX_VALUE,
        });

        expect(transaction.status).toBe('rejected');
    });

    it.each(['tempo', 'time-signature'] as const)(
        'rejects the whole operation when a computed beat overflows in the %s owner',
        (overflowOwner) => {
            const tempoBeat = overflowOwner === 'tempo' ? Number.MAX_VALUE : 4;
            const signatureBeat = overflowOwner === 'time-signature' ? Number.MAX_VALUE : 4;
            setStoreStates(
                tempoState([tempoChange('tempo', tempoBeat)]),
                timeSignatureState([timeSignatureChange('signature', signatureBeat)])
            );

            const transaction = expectClosedWithoutWrite({
                type: 'insert',
                atBeat: 0,
                durationBeats: Number.MAX_VALUE,
            });
            expect(transaction.status).toBe('rejected');
        }
    );

    it.each([
        {
            name: 'insert',
            operation: { type: 'insert' as const, atBeat: 0, durationBeats: 1 },
        },
        {
            name: 'delete',
            operation: { type: 'delete' as const, startBeat: 0, endBeat: 1 },
        },
    ])('reports no change when finite $name arithmetic rounds to the original beats', ({ operation }) => {
        const tempo = tempoChange('tempo', Number.MAX_VALUE);
        const signature = timeSignatureChange('signature', Number.MAX_VALUE);
        const capturedTempo = tempoState([tempo]);
        const capturedTimeSignature = timeSignatureState([signature]);
        setStoreStates(capturedTempo, capturedTimeSignature);

        const transaction = expectClosedWithoutWrite(operation);
        expect(transaction.status).toBe('ready');
        expect(tempoMapStore.value?.changes[0]).toBe(tempo);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signature);
    });

    it('accepts empty owner maps and writes only a structurally changed owner', () => {
        setStoreStates(tempoState([]), timeSignatureState([]));
        const emptyTransaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });
        expect(emptyTransaction.status).toBe('ready');
        vi.restoreAllMocks();

        const emptyTempo = tempoState([]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(emptyTempo, capturedTimeSignature);
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value).toBe(emptyTempo);
        expect(timeSignatureMapStore.value?.changes[0]?.beat).toBe(6);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).toHaveBeenCalledOnce();
    });

    it.each(['tempo', 'time-signature'] as const)('rejects when the %s owner store is missing', (missingOwner) => {
        const tempo = missingOwner === 'tempo' ? null : tempoState([tempoChange('tempo', 4)]);
        const timeSignature =
            missingOwner === 'time-signature' ? null : timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(tempo, timeSignature);

        const transaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });
        expect(transaction.status).toBe('rejected');
    });

    it.each(['tempo', 'time-signature'] as const)('stale-checks the %s owner before either apply write', (owner) => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const interveningTempo = tempoState([...capturedTempo.changes]);
        const interveningTimeSignature = timeSignatureState([...capturedTimeSignature.changes]);
        if (owner === 'tempo') {
            tempoMapStore.set(interveningTempo);
        } else {
            timeSignatureMapStore.set(interveningTimeSignature);
        }
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        expect(transaction.apply()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        setStoreStates(capturedTempo, capturedTimeSignature);
        tempoSet.mockClear();
        timeSignatureSet.mockClear();
        expect(transaction.apply()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it('enforces ordering and restores both exact captured state identities', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(true);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(true);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
    });

    it.each(['tempo', 'time-signature'] as const)('refuses stale revert across the %s owner and closes', (owner) => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        const interveningTempo = tempoState([tempoChange('intervening-tempo', 12)]);
        const interveningTimeSignature = timeSignatureState([timeSignatureChange('intervening-signature', 12)]);
        if (owner === 'tempo') {
            tempoMapStore.set(interveningTempo);
        } else {
            timeSignatureMapStore.set(interveningTimeSignature);
        }
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        expect(transaction.revert()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        setStoreStates(appliedTempo, appliedTimeSignature);
        tempoSet.mockClear();
        timeSignatureSet.mockClear();
        expect(transaction.revert()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it('batches apply and revert so both subscribers observe only complete states', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const observations = observeBothStores();
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(observations).toEqual([]);
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(appliedTempo);
            expect(observation.timeSignature).toBe(appliedTimeSignature);
        }

        observations.length = 0;
        expect(transaction.revert()).toBe(true);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(capturedTempo);
            expect(observation.timeSignature).toBe(capturedTimeSignature);
        }
    });

    it('compensates an ordinary second-store apply failure inside the notification batch', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const observations = observeBothStores();
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const publicationFailure = new Error('time-signature apply failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        expect(() => transaction.apply()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(capturedTempo);
            expect(observation.timeSignature).toBe(capturedTimeSignature);
        }
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('compensates an ordinary second-store revert failure back to the complete applied state', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        const observations = observeBothStores();
        const publicationFailure = new Error('time-signature revert failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        expect(() => transaction.revert()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(appliedTempo);
        expect(timeSignatureMapStore.value).toBe(appliedTimeSignature);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(appliedTempo);
            expect(observation.timeSignature).toBe(appliedTimeSignature);
        }
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('throws an explicit unrecovered-partial-state error carrying publication and compensation failures', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const publicationFailure = new Error('time-signature publication failed');
        const compensationFailure = new Error('tempo compensation failed');
        const publishTempo = tempoMapStore.set.bind(tempoMapStore);
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(tempoMapStore, 'set')
            .mockImplementationOnce(publishTempo)
            .mockImplementationOnce(() => {
                throw compensationFailure;
            });
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        let thrown: unknown;
        try {
            transaction.apply();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        if (!(thrown instanceof Error)) {
            throw new Error('Expected an Error instance');
        }
        expect(thrown).toMatchObject({
            name: 'UnrecoveredTimelineMapStateError',
            publicationFailure,
            compensationFailure,
        });
        expect(thrown.cause).toBeInstanceOf(AggregateError);
        if (!(thrown.cause instanceof AggregateError)) {
            throw new Error('Expected an AggregateError cause');
        }
        expect(thrown.cause.errors).toEqual([publicationFailure, compensationFailure]);
        expect(tempoMapStore.value).not.toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it.each([
        {
            name: 'sparse changes array',
            createTempoState: (): TempoMapStoreState => {
                const changes: TempoChange[] = [];
                changes.length = 1;
                return tempoState(changes);
            },
        },
        {
            name: 'class-instance state',
            createTempoState: (): TempoMapStoreState => {
                class TempoState implements TempoMapStoreState {
                    changes = [tempoChange('tempo', 4)];
                }
                return new TempoState();
            },
        },
        {
            name: 'accessor change',
            createTempoState: (): TempoMapStoreState => {
                const change = tempoChange('tempo', 4);
                Object.defineProperty(change, 'beat', {
                    enumerable: true,
                    get: () => 4,
                });
                return tempoState([change]);
            },
        },
    ])('rejects a non-encodable owner state with $name before writes', ({ createTempoState }) => {
        setStoreStates(createTempoState(), timeSignatureState([timeSignatureChange('signature', 4)]));

        const transaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });

        expect(transaction.status).toBe('rejected');
    });

    it('returns an exact detached JSON-round-trippable inverse plan for a changed ready operation', () => {
        const capturedTempo = tempoState([tempoChange('tempo-zero', -0), tempoChange('tempo-shifted', 4)]);
        const capturedTimeSignature = timeSignatureState([
            timeSignatureChange('signature-zero', -0),
            timeSignatureChange('signature-shifted', 4),
        ]);
        setStoreStates(capturedTempo, capturedTimeSignature);

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const plan = transaction.inversePlan;
        if (!plan) {
            throw new Error('Expected a changed operation to produce an inverse plan');
        }

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(plan).toEqual({
            version: 1,
            expected: {
                tempo: {
                    changes: [
                        {
                            id: 'tempo-zero',
                            beat: { type: 'negative-zero' },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                        {
                            id: 'tempo-shifted',
                            beat: { type: 'number', value: 6 },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                    ],
                },
                timeSignature: {
                    changes: [
                        {
                            id: 'signature-zero',
                            beat: { type: 'negative-zero' },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                        {
                            id: 'signature-shifted',
                            beat: { type: 'number', value: 6 },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                    ],
                },
            },
            replacement: {
                tempo: {
                    changes: [
                        {
                            id: 'tempo-zero',
                            beat: { type: 'negative-zero' },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                        {
                            id: 'tempo-shifted',
                            beat: { type: 'number', value: 4 },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                    ],
                },
                timeSignature: {
                    changes: [
                        {
                            id: 'signature-zero',
                            beat: { type: 'negative-zero' },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                        {
                            id: 'signature-shifted',
                            beat: { type: 'number', value: 4 },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                    ],
                },
            },
        });
        expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);

        plan.expected.tempo.changes[1]!.beat = { type: 'number', value: 12 };
        plan.replacement.timeSignature.changes[1]!.id = 'mutated-plan-id';
        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes[1]?.beat).toBe(6);
        expect(transaction.revert()).toBe(true);
        expect(timeSignatureMapStore.value?.changes[1]?.id).toBe('signature-shifted');
    });

    it.each(['tempo', 'time-signature'] as const)(
        'detects in-place %s captured-state mutation before apply without writes',
        (owner) => {
            const capturedTempo = tempoState([tempoChange('tempo', 4)]);
            const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
            setStoreStates(capturedTempo, capturedTimeSignature);
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            });
            if (owner === 'tempo') {
                capturedTempo.changes[0]!.tempo = 121;
            } else {
                capturedTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.apply()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it.each(['tempo', 'time-signature'] as const)(
        'detects in-place %s prepared-state mutation before revert without writes',
        (owner) => {
            setStoreStates(
                tempoState([tempoChange('tempo', 4)]),
                timeSignatureState([timeSignatureChange('signature', 4)])
            );
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            });
            expect(transaction.apply()).toBe(true);
            if (owner === 'tempo') {
                const appliedTempo = tempoMapStore.value;
                if (!appliedTempo) {
                    throw new Error('Expected applied tempo state');
                }
                appliedTempo.changes[0]!.tempo = 121;
            } else {
                const appliedTimeSignature = timeSignatureMapStore.value;
                if (!appliedTimeSignature) {
                    throw new Error('Expected applied time-signature state');
                }
                appliedTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.revert()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it('rejects reentrant apply and revert while preserving the outer forward publication', () => {
        setStoreStates(
            tempoState([tempoChange('tempo', 4)]),
            timeSignatureState([timeSignatureChange('signature', 4)])
        );
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const reentrantResults: boolean[] = [];
        unsubscribers.push(
            tempoMapStore.subscribe(() => {
                reentrantResults.push(transaction.apply());
                reentrantResults.push(transaction.revert());
            })
        );

        expect(transaction.apply()).toBe(true);
        expect(reentrantResults).toEqual([false, false]);
        expect(transaction.revert()).toBe(true);
        expect(reentrantResults).toEqual([false, false, false, false]);
    });
});
