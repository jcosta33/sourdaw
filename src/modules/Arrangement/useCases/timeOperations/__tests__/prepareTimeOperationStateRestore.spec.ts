import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const trackState = { value: null as unknown };
    const markerState = { value: null as unknown };
    return {
        trackState,
        markerState,
        batchDepth: 0,
        writeDepths: [] as number[],
        events: [] as string[],
        trackWriteEffect: null as ((state: unknown) => void) | null,
        markerWriteEffect: null as ((state: unknown) => void) | null,
    };
});

vi.mock('#/infra/store/createStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/createStore')>();
    return {
        ...actual,
        batchStoreUpdates<TResult>(update: () => TResult): TResult {
            mocks.batchDepth++;
            try {
                return update();
            } finally {
                mocks.batchDepth--;
            }
        },
    };
});

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: () => mocks.trackState.value,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: (state: unknown) => {
        mocks.writeDepths.push(mocks.batchDepth);
        mocks.events.push('write:track');
        if (mocks.trackWriteEffect) {
            mocks.trackWriteEffect(state);
            return;
        }
        mocks.trackState.value = state;
    },
}));

vi.mock('../../../stores/markerStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/markerStore')>();
    return {
        ...actual,
        markerStore: {
            get value() {
                return mocks.markerState.value;
            },
            set(state: unknown) {
                mocks.writeDepths.push(mocks.batchDepth);
                mocks.events.push('write:marker');
                if (mocks.markerWriteEffect) {
                    mocks.markerWriteEffect(state);
                    return;
                }
                mocks.markerState.value = state;
            },
        },
    };
});

import { TrackDummy } from '../../../__tests__/TrackDummy';
import {
    prepareTimeOperationStateRestore,
    UnrecoveredTimeOperationStateError,
} from '../prepareTimeOperationStateRestore';
import { setTimeOperationDependencies, type TimeOperationDependencies } from '../timeOperationDependencies';
import { timeOperationStateCodec } from '../timeOperationStateCodec';

type RestorePreparation = ReturnType<TimeOperationDependencies['prepareAutomationTimeStateRestore']>;
type RestorePreparer = TimeOperationDependencies['prepareAutomationTimeStateRestore'];

type OwnerPreparationOptions = {
    status?: RestorePreparation['status'];
    hasChanges?: boolean;
    applyResult?: boolean;
    revertResult?: boolean;
    applyError?: Error;
    revertError?: Error;
};

type InstallDependenciesInput = {
    prepareAutomation?: RestorePreparer;
    prepareMidi?: RestorePreparer;
    prepareTimelineMap?: RestorePreparer;
};

const OWNER_PLAN = {
    version: 1 as const,
    expected: { state: 'post' },
    replacement: { state: 'pre' },
};

function createOwnerPreparation(name: string, options: OwnerPreparationOptions = {}): RestorePreparation {
    const status = options.status ?? 'ready';
    const hasChanges = options.hasChanges ?? status === 'ready';
    return {
        status,
        hasChanges,
        apply: vi.fn(() => {
            mocks.events.push(`apply:${name}`);
            expect(mocks.batchDepth).toBe(1);
            if (options.applyError !== undefined) {
                throw options.applyError;
            }
            return options.applyResult ?? true;
        }),
        revert: vi.fn(() => {
            mocks.events.push(`revert:${name}`);
            expect(mocks.batchDepth).toBe(1);
            if (options.revertError !== undefined) {
                throw options.revertError;
            }
            return options.revertResult ?? true;
        }),
    };
}

function createNoChangePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        inversePlan: null,
        apply: () => false,
        revert: () => false,
    };
}

function installDependencies(input: InstallDependenciesInput = {}) {
    const prepareAutomation = vi.fn<RestorePreparer>(
        input.prepareAutomation ??
            (() => {
                mocks.events.push('prepare:automation');
                return createOwnerPreparation('automation');
            })
    );
    const prepareMidi = vi.fn<RestorePreparer>(
        input.prepareMidi ??
            (() => {
                mocks.events.push('prepare:midi');
                return createOwnerPreparation('midi');
            })
    );
    const prepareTimelineMap = vi.fn<RestorePreparer>(
        input.prepareTimelineMap ??
            (() => {
                mocks.events.push('prepare:timeline');
                return createOwnerPreparation('timeline');
            })
    );
    const noChange = createNoChangePreparation();
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: vi.fn(() => noChange),
        prepareAutomationTimeStateRestore: prepareAutomation,
        prepareMidiGlobalTimeTransaction: vi.fn(() => ({
            ...noChange,
            replayPlan: { version: 1 as const, notes: [] },
        })),
        prepareMidiTimeStateRestore: prepareMidi,
        prepareTimelineMapTimeOperation: vi.fn(() => noChange),
        prepareTimelineMapStateRestore: prepareTimelineMap,
    });
    return {
        prepareAutomation,
        prepareMidi,
        prepareTimelineMap,
    };
}

function createTrackState(gain: number, pan = 0) {
    return {
        tracks: [TrackDummy.create({ id: 'track-1', gain, pan })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

function createMarkerState(beat: number) {
    return {
        markers: [{ id: 'marker-1', beat, name: 'Marker', color: '#fff' }],
        sections: [],
    };
}

function requireEncodedTrackState(value: unknown): unknown {
    const encoded = timeOperationStateCodec.encodeTrackState(value);
    if (!encoded) {
        throw new Error('Expected valid encoded Track state');
    }
    return encoded;
}

function requireEncodedMarkerState(value: unknown): unknown {
    const encoded = timeOperationStateCodec.encodeMarkerState(value);
    if (!encoded) {
        throw new Error('Expected valid encoded marker state');
    }
    return encoded;
}

function createPlan(input: {
    scope: 'global' | 'selected-range';
    expectedTrackState: unknown;
    replacementTrackState: unknown;
    expectedMarkerState?: unknown;
    replacementMarkerState?: unknown;
    automation?: unknown;
    midi?: unknown;
    timelineMap?: unknown;
}) {
    let expectedMarkerState: unknown = null;
    let replacementMarkerState: unknown = null;
    if (input.scope === 'global') {
        expectedMarkerState = requireEncodedMarkerState(input.expectedMarkerState);
        replacementMarkerState = requireEncodedMarkerState(input.replacementMarkerState);
    }
    return {
        version: 1 as const,
        scope: input.scope,
        local: {
            version: 1 as const,
            expected: {
                trackState: requireEncodedTrackState(input.expectedTrackState),
                markerState: expectedMarkerState,
            },
            replacement: {
                trackState: requireEncodedTrackState(input.replacementTrackState),
                markerState: replacementMarkerState,
            },
        },
        automation: input.automation ?? null,
        midi: input.midi ?? null,
        timelineMap: input.timelineMap ?? null,
    };
}

function setCurrentState(trackState: unknown, markerState: unknown): void {
    mocks.trackState.value = trackState;
    mocks.markerState.value = markerState;
}

function expectRejected(value: unknown): void {
    const result = prepareTimeOperationStateRestore(value);
    expect(result.status).toBe('rejected');
    expect(result.hasChanges).toBe(false);
    expect(result.apply()).toBe(false);
    expect(result.revert()).toBe(false);
}

const GLOBAL_PARTICIPANT_COMBINATIONS = [
    { label: 'local only', automation: false, midi: false, timelineMap: false },
    { label: 'Automation', automation: true, midi: false, timelineMap: false },
    { label: 'MIDI', automation: false, midi: true, timelineMap: false },
    { label: 'timeline map', automation: false, midi: false, timelineMap: true },
    { label: 'Automation and MIDI', automation: true, midi: true, timelineMap: false },
    { label: 'Automation and timeline map', automation: true, midi: false, timelineMap: true },
    { label: 'MIDI and timeline map', automation: false, midi: true, timelineMap: true },
    { label: 'all owners', automation: true, midi: true, timelineMap: true },
] as const;

describe('prepareTimeOperationStateRestore', () => {
    beforeEach(() => {
        mocks.batchDepth = 0;
        mocks.writeDepths.length = 0;
        mocks.events.length = 0;
        mocks.trackWriteEffect = null;
        mocks.markerWriteEffect = null;
        setTimeOperationDependencies(null);
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it.each(GLOBAL_PARTICIPANT_COMBINATIONS)(
        'supports a global restore with $label',
        ({ automation, midi, timelineMap }) => {
            const expectedTrackState = createTrackState(2);
            const replacementTrackState = createTrackState(1);
            const expectedMarkerState = createMarkerState(8);
            const replacementMarkerState = createMarkerState(4);
            setCurrentState(expectedTrackState, expectedMarkerState);
            const dependencies = installDependencies();
            const plan = createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState,
                replacementMarkerState,
                automation: automation ? OWNER_PLAN : null,
                midi: midi ? OWNER_PLAN : null,
                timelineMap: timelineMap ? OWNER_PLAN : null,
            });

            const transaction = prepareTimeOperationStateRestore(JSON.parse(JSON.stringify(plan)));

            expect(transaction.status).toBe('ready');
            expect(transaction.hasChanges).toBe(true);
            expect(dependencies.prepareAutomation).toHaveBeenCalledTimes(automation ? 1 : 0);
            expect(dependencies.prepareMidi).toHaveBeenCalledTimes(midi ? 1 : 0);
            expect(dependencies.prepareTimelineMap).toHaveBeenCalledTimes(timelineMap ? 1 : 0);
            expect(mocks.writeDepths).toEqual([]);
            expect(transaction.apply()).toBe(true);
            expect(mocks.trackState.value).toEqual(replacementTrackState);
            expect(mocks.markerState.value).toEqual(replacementMarkerState);
            expect(mocks.writeDepths.every((depth) => depth === 1)).toBe(true);
        }
    );

    it.each([
        { label: 'local only', midi: false },
        { label: 'local and MIDI', midi: true },
    ])('supports a selected-range restore with $label', ({ midi }) => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        const dependencies = installDependencies();
        const plan = createPlan({
            scope: 'selected-range',
            expectedTrackState,
            replacementTrackState,
            midi: midi ? OWNER_PLAN : null,
        });

        const transaction = prepareTimeOperationStateRestore(plan);

        expect(transaction.status).toBe('ready');
        expect(dependencies.prepareAutomation).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMap).not.toHaveBeenCalled();
        expect(dependencies.prepareMidi).toHaveBeenCalledTimes(midi ? 1 : 0);
        expect(transaction.apply()).toBe(true);
        expect(mocks.trackState.value).toEqual(replacementTrackState);
        expect(mocks.markerState.value).toBe(markerState);
    });

    it('restores and redoes exact values with fresh reversed owner preparations', () => {
        const expectedTrackState = createTrackState(2, -0);
        const replacementTrackState = createTrackState(1, 0);
        const expectedMarkerState = createMarkerState(8);
        const replacementMarkerState = createMarkerState(4);
        setCurrentState(expectedTrackState, expectedMarkerState);
        const dependencies = installDependencies();
        const plan = createPlan({
            scope: 'global',
            expectedTrackState,
            replacementTrackState,
            expectedMarkerState,
            replacementMarkerState,
            automation: OWNER_PLAN,
            midi: OWNER_PLAN,
            timelineMap: OWNER_PLAN,
        });
        const transaction = prepareTimeOperationStateRestore(plan);

        expect(mocks.events).toEqual(['prepare:automation', 'prepare:midi', 'prepare:timeline']);
        expect(transaction.apply()).toBe(true);
        expect(Object.is((mocks.trackState.value as typeof replacementTrackState).tracks[0]?.pan, 0)).toBe(true);
        expect(transaction.revert()).toBe(true);
        expect(mocks.trackState.value).toEqual(expectedTrackState);
        expect(Object.is((mocks.trackState.value as typeof expectedTrackState).tracks[0]?.pan, -0)).toBe(true);
        expect(mocks.markerState.value).toEqual(expectedMarkerState);
        expect(dependencies.prepareAutomation).toHaveBeenCalledTimes(2);
        expect(dependencies.prepareMidi).toHaveBeenCalledTimes(2);
        expect(dependencies.prepareTimelineMap).toHaveBeenCalledTimes(2);
        expect(dependencies.prepareAutomation.mock.calls[1]?.[0]).toEqual({
            version: 1,
            expected: OWNER_PLAN.replacement,
            replacement: OWNER_PLAN.expected,
        });
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('returns a closed ready no-change handle for an equal-state plan', () => {
        const trackState = createTrackState(1);
        const markerState = createMarkerState(4);
        setCurrentState(trackState, markerState);
        const dependencies = installDependencies();
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'global',
                expectedTrackState: trackState,
                replacementTrackState: structuredClone(trackState),
                expectedMarkerState: markerState,
                replacementMarkerState: structuredClone(markerState),
            })
        );

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(dependencies.prepareAutomation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidi).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMap).not.toHaveBeenCalled();
        expect(mocks.writeDepths).toEqual([]);
    });

    it('rejects malformed, partial, extra-key, wrong-version, wrong-scope, and contradictory envelopes before owner preparation', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const expectedMarkerState = createMarkerState(8);
        const replacementMarkerState = createMarkerState(4);
        setCurrentState(expectedTrackState, expectedMarkerState);
        const dependencies = installDependencies();
        const valid = createPlan({
            scope: 'global',
            expectedTrackState,
            replacementTrackState,
            expectedMarkerState,
            replacementMarkerState,
        });
        const selected = createPlan({
            scope: 'selected-range',
            expectedTrackState,
            replacementTrackState,
        });
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const accessor = Object.defineProperty({}, 'version', {
            enumerable: true,
            get: () => 1,
        });
        const invalidPlans: unknown[] = [
            null,
            { ...valid, version: 2 },
            { ...valid, scope: 'other' },
            { ...valid, extra: true },
            { ...valid, local: { version: 1, expected: valid.local.expected } },
            {
                ...valid,
                local: {
                    ...valid.local,
                    expected: { trackState: valid.local.expected.trackState },
                },
            },
            { ...selected, automation: OWNER_PLAN },
            {
                ...selected,
                local: {
                    ...selected.local,
                    expected: {
                        ...selected.local.expected,
                        markerState: requireEncodedMarkerState(expectedMarkerState),
                    },
                },
            },
            { ...valid, automation: { ...OWNER_PLAN, extra: true } },
            cyclic,
            accessor,
        ];

        for (const invalid of invalidPlans) {
            expectRejected(invalid);
        }
        expect(dependencies.prepareAutomation).not.toHaveBeenCalled();
        expect(dependencies.prepareMidi).not.toHaveBeenCalled();
        expect(dependencies.prepareTimelineMap).not.toHaveBeenCalled();
        expect(mocks.writeDepths).toEqual([]);
    });

    it.each([
        { label: 'rejected', preparation: createOwnerPreparation('automation', { status: 'rejected' }) },
        { label: 'unexpected no-change', preparation: createOwnerPreparation('automation', { hasChanges: false }) },
    ])('rejects a non-null owner plan when its preparation is $label', ({ preparation }) => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        installDependencies({
            prepareAutomation: vi.fn(() => preparation),
        });

        expectRejected(
            createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState: markerState,
                replacementMarkerState: markerState,
                automation: OWNER_PLAN,
            })
        );
        expect(mocks.writeDepths).toEqual([]);
    });

    it('rejects stale references and in-place mutations without applying an owner', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        const dependencies = installDependencies();
        const plan = createPlan({
            scope: 'selected-range',
            expectedTrackState,
            replacementTrackState,
            midi: OWNER_PLAN,
        });
        const staleReference = prepareTimeOperationStateRestore(plan);
        mocks.trackState.value = structuredClone(expectedTrackState);

        expect(staleReference.apply()).toBe(false);
        expect(dependencies.prepareMidi).toHaveBeenCalledTimes(1);
        expect(mocks.events).toContain('apply:midi');
        expect(mocks.events).toContain('revert:midi');
        expect(mocks.writeDepths).toEqual([]);

        setCurrentState(expectedTrackState, markerState);
        mocks.events.length = 0;
        const mutated = prepareTimeOperationStateRestore(plan);
        expectedTrackState.tracks[0]!.gain = 9;

        expect(mutated.apply()).toBe(false);
        expect(mocks.events).toContain('apply:midi');
        expect(mocks.events).toContain('revert:midi');
        expect(mocks.writeDepths).toEqual([]);
    });

    it('detaches the accepted plan before caller mutation', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        installDependencies();
        const plan = createPlan({
            scope: 'selected-range',
            expectedTrackState,
            replacementTrackState,
        });
        const transaction = prepareTimeOperationStateRestore(plan);
        plan.local.replacement.trackState = plan.local.expected.trackState;

        expect(transaction.apply()).toBe(true);
        expect(mocks.trackState.value).toEqual(replacementTrackState);
    });

    it('compensates successful participants in reverse order after an ordinary publication rejection', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        installDependencies({
            prepareAutomation: vi.fn(() => createOwnerPreparation('automation')),
            prepareMidi: vi.fn(() => createOwnerPreparation('midi', { applyResult: false })),
            prepareTimelineMap: vi.fn(() => createOwnerPreparation('timeline')),
        });
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState: markerState,
                replacementMarkerState: markerState,
                automation: OWNER_PLAN,
                midi: OWNER_PLAN,
                timelineMap: OWNER_PLAN,
            })
        );

        expect(transaction.apply()).toBe(false);
        expect(mocks.events.filter((event) => event.startsWith('revert:'))).toEqual([
            'revert:timeline',
            'revert:automation',
        ]);
        expect(mocks.events.at(-1)).toBe('write:track');
        expect(mocks.trackState.value).toEqual(expectedTrackState);
    });

    it('continues reverse compensation and reports every unrecovered failure', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        const timelineFailure = new Error('timeline compensation failed');
        setCurrentState(expectedTrackState, markerState);
        installDependencies({
            prepareAutomation: vi.fn(() =>
                createOwnerPreparation('automation', {
                    revertResult: false,
                })
            ),
            prepareMidi: vi.fn(() => createOwnerPreparation('midi', { applyResult: false })),
            prepareTimelineMap: vi.fn(() =>
                createOwnerPreparation('timeline', {
                    revertError: timelineFailure,
                })
            ),
        });
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState: markerState,
                replacementMarkerState: markerState,
                automation: OWNER_PLAN,
                midi: OWNER_PLAN,
                timelineMap: OWNER_PLAN,
            })
        );

        let thrown: unknown;
        try {
            transaction.apply();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(UnrecoveredTimeOperationStateError);
        if (!(thrown instanceof UnrecoveredTimeOperationStateError)) {
            throw new Error('Expected explicit unrecovered restore state');
        }
        expect(thrown.compensationFailures).toHaveLength(2);
        expect(thrown.compensationFailures).toContain(timelineFailure);
        expect(mocks.events.filter((event) => event.startsWith('revert:'))).toEqual([
            'revert:timeline',
            'revert:automation',
        ]);
        expect(mocks.events.at(-1)).toBe('write:track');
        expect(mocks.trackState.value).toEqual(expectedTrackState);
    });

    it('recovers an exact local write that throws after publication', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const expectedMarkerState = createMarkerState(8);
        const replacementMarkerState = createMarkerState(4);
        const publicationFailure = new Error('marker publication failed');
        setCurrentState(expectedTrackState, expectedMarkerState);
        installDependencies();
        let firstMarkerWrite = true;
        mocks.markerWriteEffect = (state) => {
            mocks.markerState.value = state;
            if (firstMarkerWrite) {
                firstMarkerWrite = false;
                throw publicationFailure;
            }
        };
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState,
                replacementMarkerState,
            })
        );

        expect(() => transaction.apply()).toThrow(publicationFailure);
        expect(mocks.trackState.value).toEqual(expectedTrackState);
        expect(mocks.markerState.value).toEqual(expectedMarkerState);
    });

    it('reports an unexpected local state left by a throwing publisher', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const expectedMarkerState = createMarkerState(8);
        const replacementMarkerState = createMarkerState(4);
        const unexpectedMarkerState = createMarkerState(99);
        setCurrentState(expectedTrackState, expectedMarkerState);
        installDependencies();
        mocks.markerWriteEffect = () => {
            mocks.markerState.value = unexpectedMarkerState;
            throw new Error('marker publication failed after mutation');
        };
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'global',
                expectedTrackState,
                replacementTrackState,
                expectedMarkerState,
                replacementMarkerState,
            })
        );

        expect(() => transaction.apply()).toThrow(UnrecoveredTimeOperationStateError);
        expect(mocks.trackState.value).toEqual(expectedTrackState);
        expect(mocks.markerState.value).toBe(unexpectedMarkerState);
    });

    it('rejects synchronous reentrancy while keeping the outer publication atomic', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        installDependencies();
        const transaction = prepareTimeOperationStateRestore(
            createPlan({
                scope: 'selected-range',
                expectedTrackState,
                replacementTrackState,
            })
        );
        const reentrantResults: boolean[] = [];
        mocks.trackWriteEffect = (state) => {
            mocks.trackState.value = state;
            reentrantResults.push(transaction.apply(), transaction.revert());
        };

        expect(transaction.apply()).toBe(true);
        expect(reentrantResults).toEqual([false, false]);
        expect(mocks.trackState.value).toEqual(replacementTrackState);
        expect(mocks.writeDepths).toEqual([1]);
    });

    it('closes on out-of-order or repeated lifecycle calls', () => {
        const expectedTrackState = createTrackState(2);
        const replacementTrackState = createTrackState(1);
        const markerState = createMarkerState(8);
        setCurrentState(expectedTrackState, markerState);
        installDependencies();
        const plan = createPlan({
            scope: 'selected-range',
            expectedTrackState,
            replacementTrackState,
        });
        const outOfOrder = prepareTimeOperationStateRestore(plan);

        expect(outOfOrder.revert()).toBe(false);
        expect(outOfOrder.apply()).toBe(false);

        const applied = prepareTimeOperationStateRestore(plan);
        expect(applied.apply()).toBe(true);
        expect(applied.apply()).toBe(false);
        expect(applied.revert()).toBe(false);
    });
});
