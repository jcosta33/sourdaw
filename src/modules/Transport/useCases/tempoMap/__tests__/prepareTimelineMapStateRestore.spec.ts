import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TempoChange, TempoMapStoreState } from '../../../stores/tempoMapStore';
import type { TimeSignatureChange, TimeSignatureMapStoreState } from '../../../stores/timeSignatureMapStore';

vi.mock('../../../stores/tempoMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/tempoMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');
    return {
        ...actual,
        tempoMapStore: createStore<TempoMapStoreState>(),
    };
});

vi.mock('../../../stores/timeSignatureMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/timeSignatureMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');
    return {
        ...actual,
        timeSignatureMapStore: createStore<TimeSignatureMapStoreState>(),
    };
});

const { tempoMapStore } = await import('../../../stores/tempoMapStore');
const { timeSignatureMapStore } = await import('../../../stores/timeSignatureMapStore');
const { prepareTimelineMapStateRestore } = await import('../prepareTimelineMapStateRestore');
const { prepareTimelineMapTimeOperation } = await import('../prepareTimelineMapTimeOperation');

type TimelineMapRestorePlan = NonNullable<ReturnType<typeof prepareTimelineMapTimeOperation>['inversePlan']>;

type AppliedPlanFixture = {
    plan: TimelineMapRestorePlan;
    capturedTempo: TempoMapStoreState;
    capturedTimeSignature: TimeSignatureMapStoreState;
    appliedTempo: TempoMapStoreState;
    appliedTimeSignature: TimeSignatureMapStoreState;
};

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

function createAppliedPlan({
    tempo = tempoState([tempoChange('tempo-zero', -0), tempoChange('tempo-shifted', 4)]),
    timeSignature = timeSignatureState([
        timeSignatureChange('signature-zero', -0),
        timeSignatureChange('signature-shifted', 4),
    ]),
}: {
    tempo?: TempoMapStoreState;
    timeSignature?: TimeSignatureMapStoreState;
} = {}): AppliedPlanFixture {
    setStoreStates(tempo, timeSignature);
    const transaction = prepareTimelineMapTimeOperation({
        operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
    });
    const plan = transaction.inversePlan;
    if (!plan) {
        throw new Error('Expected a changed operation to produce an inverse plan');
    }
    expect(transaction.apply()).toBe(true);
    const appliedTempo = tempoMapStore.value;
    const appliedTimeSignature = timeSignatureMapStore.value;
    if (!appliedTempo || !appliedTimeSignature) {
        throw new Error('Expected both timeline map states after forward apply');
    }
    return {
        plan,
        capturedTempo: tempo,
        capturedTimeSignature: timeSignature,
        appliedTempo,
        appliedTimeSignature,
    };
}

function expectRejectedWithoutWrite(plan: unknown): void {
    const capturedTempo = tempoMapStore.value;
    const capturedTimeSignature = timeSignatureMapStore.value;
    const tempoSet = vi.spyOn(tempoMapStore, 'set');
    const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

    const transaction = prepareTimelineMapStateRestore(plan);

    expect(transaction.status).toBe('rejected');
    expect(transaction.hasChanges).toBe(false);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(tempoMapStore.value).toBe(capturedTempo);
    expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
    expect(tempoSet).not.toHaveBeenCalled();
    expect(timeSignatureSet).not.toHaveBeenCalled();
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

describe('prepareTimelineMapStateRestore', () => {
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

    it('prepares without effects and restores then redoes exact two-map state identities', () => {
        const fixture = createAppliedPlan();
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapStateRestore(fixture.plan);

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(tempoMapStore.value).toBe(fixture.appliedTempo);
        expect(timeSignatureMapStore.value).toBe(fixture.appliedTimeSignature);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value).toEqual(fixture.capturedTempo);
        expect(timeSignatureMapStore.value).toEqual(fixture.capturedTimeSignature);
        expect(Object.is(tempoMapStore.value?.changes[0]?.beat, -0)).toBe(true);
        expect(Object.is(timeSignatureMapStore.value?.changes[0]?.beat, -0)).toBe(true);

        expect(transaction.revert()).toBe(true);
        expect(tempoMapStore.value).toBe(fixture.appliedTempo);
        expect(timeSignatureMapStore.value).toBe(fixture.appliedTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('accepts a JSON-round-tripped plan', () => {
        const fixture = createAppliedPlan();
        const roundTrippedPlan: unknown = JSON.parse(JSON.stringify(fixture.plan));
        const transaction = prepareTimelineMapStateRestore(roundTrippedPlan);

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes[0]?.id).toBe('tempo-zero');
        expect(timeSignatureMapStore.value?.changes[0]?.id).toBe('signature-zero');
    });

    it('keeps decoded state detached from later input-plan mutation', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        fixture.plan.replacement.tempo.changes[0]!.id = 'mutated-plan-id';
        fixture.plan.replacement.timeSignature.changes[0]!.id = 'mutated-signature-plan-id';
        fixture.plan.expected.tempo.changes[0]!.id = 'mutated-expected-plan-id';

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes[0]?.id).toBe('tempo-zero');
        expect(timeSignatureMapStore.value?.changes[0]?.id).toBe('signature-zero');
    });

    it('returns a ready closed handle when expected and replacement pairs are equal', () => {
        const fixture = createAppliedPlan();
        const noChangePlan: TimelineMapRestorePlan = {
            version: 1,
            expected: structuredClone(fixture.plan.expected),
            replacement: structuredClone(fixture.plan.expected),
        };
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapStateRestore(noChangePlan);

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'wrong version', create: (plan: TimelineMapRestorePlan): unknown => ({ ...plan, version: 2 }) },
        {
            name: 'missing expected time-signature map',
            create: (plan: TimelineMapRestorePlan): unknown => ({
                ...plan,
                expected: { tempo: plan.expected.tempo },
            }),
        },
        {
            name: 'extra replacement map',
            create: (plan: TimelineMapRestorePlan): unknown => ({
                ...plan,
                replacement: { ...plan.replacement, automation: { changes: [] } },
            }),
        },
        {
            name: 'invalid tempo value',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                invalid.expected.tempo.changes[0]!.tempo = { type: 'number', value: 2 };
                return invalid;
            },
        },
        {
            name: 'non-finite encoded beat',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                invalid.expected.timeSignature.changes[0]!.beat = {
                    type: 'number',
                    value: Number.POSITIVE_INFINITY,
                };
                return invalid;
            },
        },
        {
            name: 'invalid time-signature numerator',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                invalid.replacement.timeSignature.changes[0]!.numerator = { type: 'number', value: 33 };
                return invalid;
            },
        },
        {
            name: 'sparse changes array',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                Reflect.deleteProperty(invalid.expected.tempo.changes, '0');
                return invalid;
            },
        },
        {
            name: 'accessor array entry',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                const firstChange = invalid.expected.tempo.changes[0];
                Object.defineProperty(invalid.expected.tempo.changes, '0', {
                    enumerable: true,
                    get: () => firstChange,
                });
                return invalid;
            },
        },
        {
            name: 'symbol-keyed state',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid = structuredClone(plan);
                Object.defineProperty(invalid.expected.tempo, Symbol('extra'), {
                    enumerable: true,
                    value: true,
                });
                return invalid;
            },
        },
        {
            name: 'class-instance envelope',
            create: (plan: TimelineMapRestorePlan): unknown => {
                class RestoreEnvelope {
                    version = 1;
                    expected = plan.expected;
                    replacement = plan.replacement;
                }
                return new RestoreEnvelope();
            },
        },
        {
            name: 'accessor envelope',
            create: (plan: TimelineMapRestorePlan): unknown => {
                const invalid: Record<string, unknown> = {
                    version: 1,
                    replacement: plan.replacement,
                };
                Object.defineProperty(invalid, 'expected', {
                    enumerable: true,
                    get: () => plan.expected,
                });
                return invalid;
            },
        },
    ])('rejects a malformed or partial plan with $name before writes', ({ create }) => {
        const fixture = createAppliedPlan();
        expectRejectedWithoutWrite(create(fixture.plan));
    });

    it('rejects a cyclic plan before writes', () => {
        const fixture = createAppliedPlan();
        const cyclic: Record<string, unknown> = {
            version: 1,
            expected: fixture.plan.expected,
        };
        cyclic.replacement = cyclic;

        expectRejectedWithoutWrite(cyclic);
    });

    it.each(['tempo', 'time-signature'] as const)('rejects when the %s owner store is missing', (owner) => {
        const fixture = createAppliedPlan();
        if (owner === 'tempo') {
            setStoreStates(null, fixture.appliedTimeSignature);
        } else {
            setStoreStates(fixture.appliedTempo, null);
        }

        expectRejectedWithoutWrite(fixture.plan);
    });

    it.each(['tempo', 'time-signature'] as const)(
        'rejects stale %s owner reference before either write and closes permanently',
        (owner) => {
            const fixture = createAppliedPlan();
            const transaction = prepareTimelineMapStateRestore(fixture.plan);
            if (owner === 'tempo') {
                tempoMapStore.set(tempoState([...fixture.appliedTempo.changes]));
            } else {
                timeSignatureMapStore.set(timeSignatureState([...fixture.appliedTimeSignature.changes]));
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.apply()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();

            setStoreStates(fixture.appliedTempo, fixture.appliedTimeSignature);
            expect(transaction.apply()).toBe(false);
        }
    );

    it.each(['tempo', 'time-signature'] as const)(
        'rejects in-place %s owner value mutation before either write',
        (owner) => {
            const fixture = createAppliedPlan();
            const transaction = prepareTimelineMapStateRestore(fixture.plan);
            if (owner === 'tempo') {
                fixture.appliedTempo.changes[0]!.tempo = 121;
            } else {
                fixture.appliedTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.apply()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it.each(['tempo', 'time-signature'] as const)(
        'rejects in-place %s replacement-state mutation before revert without writes',
        (owner) => {
            const fixture = createAppliedPlan();
            const transaction = prepareTimelineMapStateRestore(fixture.plan);
            expect(transaction.apply()).toBe(true);
            if (owner === 'tempo') {
                const restoredTempo = tempoMapStore.value;
                if (!restoredTempo) {
                    throw new Error('Expected restored tempo state');
                }
                restoredTempo.changes[0]!.tempo = 121;
            } else {
                const restoredTimeSignature = timeSignatureMapStore.value;
                if (!restoredTimeSignature) {
                    throw new Error('Expected restored time-signature state');
                }
                restoredTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.revert()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it.each(['tempo', 'time-signature'] as const)(
        'rejects stale %s owner reference before revert and closes permanently',
        (owner) => {
            const fixture = createAppliedPlan();
            const transaction = prepareTimelineMapStateRestore(fixture.plan);
            expect(transaction.apply()).toBe(true);
            const restoredTempo = tempoMapStore.value;
            const restoredTimeSignature = timeSignatureMapStore.value;
            if (!restoredTempo || !restoredTimeSignature) {
                throw new Error('Expected both restored timeline-map states');
            }
            if (owner === 'tempo') {
                tempoMapStore.set(tempoState([...restoredTempo.changes]));
            } else {
                timeSignatureMapStore.set(timeSignatureState([...restoredTimeSignature.changes]));
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.revert()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();

            setStoreStates(restoredTempo, restoredTimeSignature);
            tempoSet.mockClear();
            timeSignatureSet.mockClear();
            expect(transaction.revert()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it('fails closed on out-of-order and repeated lifecycle calls', () => {
        const fixture = createAppliedPlan();
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');
        const outOfOrderTransaction = prepareTimelineMapStateRestore(fixture.plan);

        expect(outOfOrderTransaction.revert()).toBe(false);
        expect(outOfOrderTransaction.apply()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        const repeatedTransaction = prepareTimelineMapStateRestore(fixture.plan);
        expect(repeatedTransaction.apply()).toBe(true);
        expect(repeatedTransaction.apply()).toBe(false);
        expect(repeatedTransaction.revert()).toBe(false);
    });

    it('writes only the changed owner', () => {
        const fixture = createAppliedPlan({
            tempo: tempoState([tempoChange('tempo', 4)]),
            timeSignature: timeSignatureState([]),
        });
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        expect(transaction.apply()).toBe(true);

        expect(tempoSet).toHaveBeenCalledOnce();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it('batches apply and revert so subscribers observe only complete pairs', () => {
        const fixture = createAppliedPlan();
        const observations = observeBothStores();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);

        expect(transaction.apply()).toBe(true);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toEqual(fixture.capturedTempo);
            expect(observation.timeSignature).toEqual(fixture.capturedTimeSignature);
        }

        observations.length = 0;
        expect(transaction.revert()).toBe(true);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(fixture.appliedTempo);
            expect(observation.timeSignature).toBe(fixture.appliedTimeSignature);
        }
    });

    it('rejects reentrant apply and revert while allowing the outer publication to complete', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        const reentrantApplyResults: boolean[] = [];
        unsubscribers.push(
            tempoMapStore.subscribe(() => {
                reentrantApplyResults.push(transaction.apply());
                reentrantApplyResults.push(transaction.revert());
            })
        );

        expect(transaction.apply()).toBe(true);
        expect(reentrantApplyResults).toEqual([false, false]);
        expect(transaction.revert()).toBe(true);
        expect(reentrantApplyResults).toEqual([false, false, false, false]);
    });

    it('compensates an ordinary second-owner publication failure to the complete expected pair', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        const publicationFailure = new Error('time-signature restore failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((state) => {
            publishTimeSignature(state);
            throw publicationFailure;
        });

        expect(() => transaction.apply()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(fixture.appliedTempo);
        expect(timeSignatureMapStore.value).toBe(fixture.appliedTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('treats a non-publishing setter as failure and compensates the first owner', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce(() => undefined);

        expect(() => transaction.apply()).toThrow('Time-signature map store did not publish the expected state');
        expect(tempoMapStore.value).toBe(fixture.appliedTempo);
        expect(timeSignatureMapStore.value).toBe(fixture.appliedTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('compensates an ordinary second-owner revert failure to the complete restored pair', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        expect(transaction.apply()).toBe(true);
        const restoredTempo = tempoMapStore.value;
        const restoredTimeSignature = timeSignatureMapStore.value;
        const publicationFailure = new Error('time-signature redo failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((state) => {
            publishTimeSignature(state);
            throw publicationFailure;
        });

        expect(() => transaction.revert()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(restoredTempo);
        expect(timeSignatureMapStore.value).toBe(restoredTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('surfaces publication and compensation failures as unrecovered partial state', () => {
        const fixture = createAppliedPlan();
        const transaction = prepareTimelineMapStateRestore(fixture.plan);
        const publicationFailure = new Error('time-signature restore failed');
        const compensationFailure = new Error('tempo compensation failed');
        const publishTempo = tempoMapStore.set.bind(tempoMapStore);
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(tempoMapStore, 'set')
            .mockImplementationOnce(publishTempo)
            .mockImplementationOnce(() => {
                throw compensationFailure;
            });
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((state) => {
            publishTimeSignature(state);
            throw publicationFailure;
        });

        let thrown: unknown;
        try {
            transaction.apply();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({
            name: 'UnrecoveredTimelineMapStateError',
            publicationFailure,
            compensationFailure,
        });
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });
});
