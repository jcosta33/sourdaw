import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane, AutomationPoint } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        set: vi.fn((nextState: AutomationStoreState | null): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/automationStore')>();

    return {
        ...actual,
        automationStore: {
            get value(): AutomationStoreState | null {
                return mocks.state.value;
            },
            set: mocks.set,
        },
    };
});

const { prepareAutomationTimeStateRestore } = await import('../prepareAutomationTimeStateRestore');

function point(beat: number, value: number): AutomationPoint {
    return {
        beat,
        value,
        curve: 'linear',
        tension: 0,
    };
}

function lane(overrides: Partial<AutomationLane> = {}): AutomationLane {
    return {
        id: 'lane-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        clipAutomationMode: 'additive',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [point(4, 0.5)],
        trimPoints: [point(0.25, 0.1)],
        objects: [
            {
                id: 'object-1',
                laneId: 'lane-1',
                startBeat: 0.5,
                endBeat: 1.5,
                points: [point(0.75, 0.2)],
                poolId: 'pool-1',
                loopLength: 1,
                overrides: { value: true },
                name: 'Object',
            },
        ],
        ghostPoints: [point(0.5, 0.3)],
        visible: true,
        enabled: true,
        collapsed: false,
        linkedLaneId: 'lane-source',
        linkScale: -1,
        minValue: 0,
        maxValue: 1,
        viewMinValue: 0.1,
        viewMaxValue: 0.9,
        color: '#abcdef',
        ...overrides,
    };
}

function stateAtBeat(beat: number): AutomationStoreState {
    return {
        lanes: [lane({ points: [point(beat, 0.5)] })],
    };
}

function plan(expected: unknown, replacement: unknown) {
    return {
        version: 1,
        expected,
        replacement,
    };
}

function expectRejectedWithoutWrite(input: unknown, currentState: AutomationStoreState | null): void {
    mocks.state.value = currentState;

    const transaction = prepareAutomationTimeStateRestore(input);

    expect(transaction).toHaveProperty('status', 'rejected');
    expect(transaction.hasChanges).toBe(false);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.state.value).toBe(currentState);
    expect(mocks.set).not.toHaveBeenCalled();
}

describe('prepareAutomationTimeStateRestore', () => {
    beforeEach(() => {
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('rejects a stale expected state without overwriting a foreign edit', () => {
        const foreignState = stateAtBeat(12);

        expectRejectedWithoutWrite(plan(stateAtBeat(6), stateAtBeat(4)), foreignState);
    });

    it('accepts a JSON-parsed plan and restores its complete replacement state', () => {
        const currentState = stateAtBeat(6);
        const replacementState = {
            lanes: [
                lane({
                    points: [
                        {
                            beat: 4,
                            value: 0.75,
                            curve: 'bezier',
                            tension: 0.2,
                            stairSteps: 4,
                            cp1: { x: 0.2, y: 0.3 },
                            cp2: { x: 0.8, y: 0.7 },
                        },
                    ],
                }),
            ],
        };
        const parsedPlan: unknown = JSON.parse(JSON.stringify(plan(structuredClone(currentState), replacementState)));
        mocks.state.value = currentState;

        const transaction = prepareAutomationTimeStateRestore(parsedPlan);

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(currentState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(transaction.apply()).toBe(true);
        expect(mocks.state.value).toEqual(replacementState);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(currentState);
    });

    it('publishes the exact validated replacement and restores the exact captured current reference', () => {
        const currentState = stateAtBeat(6);
        const expectedState = structuredClone(currentState);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;

        const transaction = prepareAutomationTimeStateRestore(plan(expectedState, replacementState));

        expect(transaction.apply()).toBe(true);
        expect(mocks.state.value).toBe(replacementState);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(currentState);
    });

    it('validates without mutating the supplied plan', () => {
        const currentState = stateAtBeat(6);
        const suppliedPlan = plan(structuredClone(currentState), stateAtBeat(4));
        const originalPlan = structuredClone(suppliedPlan);
        mocks.state.value = currentState;

        const transaction = prepareAutomationTimeStateRestore(suppliedPlan);

        expect(transaction).toHaveProperty('status', 'ready');
        expect(suppliedPlan).toEqual(originalPlan);
        expect(mocks.state.value).toBe(currentState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('reports a value-equal expected and replacement pair as ready without changes', () => {
        const currentState = stateAtBeat(6);
        const expectedState = structuredClone(currentState);
        const replacementState = structuredClone(currentState);
        mocks.state.value = currentState;

        const transaction = prepareAutomationTimeStateRestore(plan(expectedState, replacementState));

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(currentState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('compares complete state values rather than object key order', () => {
        const currentState: AutomationStoreState = {
            lanes: [
                lane({
                    objects: [
                        {
                            id: 'object-1',
                            laneId: 'lane-1',
                            startBeat: 0.5,
                            endBeat: 1.5,
                            points: [point(0.75, 0.2)],
                            overrides: { gain: true, pan: false },
                            name: 'Object',
                        },
                    ],
                }),
            ],
        };
        const expectedState = structuredClone(currentState);
        const expectedObject = expectedState.lanes[0]?.objects[0];
        if (!expectedObject) {
            throw new Error('expected fixture object');
        }
        expectedObject.overrides = { pan: false, gain: true };
        const replacementState = stateAtBeat(2);
        mocks.state.value = currentState;

        const transaction = prepareAutomationTimeStateRestore(plan(expectedState, replacementState));

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(mocks.state.value).toBe(replacementState);
    });

    it.each([
        undefined,
        null,
        [],
        new Date(0),
        {},
        { version: 1 },
        { version: 1, expected: stateAtBeat(6) },
        { version: 1, replacement: stateAtBeat(4) },
        { version: 0, expected: stateAtBeat(6), replacement: stateAtBeat(4) },
        { version: 2, expected: stateAtBeat(6), replacement: stateAtBeat(4) },
        { version: 1, expected: stateAtBeat(6), replacement: stateAtBeat(4), extra: true },
    ])('rejects malformed, versioned, partial, or extra-key plan roots', (input) => {
        expectRejectedWithoutWrite(input, stateAtBeat(6));
    });

    it('rejects a non-plain plan root', () => {
        class RestorePlan {
            version = 1;
            expected = stateAtBeat(6);
            replacement = stateAtBeat(4);
        }

        expectRejectedWithoutWrite(new RestorePlan(), stateAtBeat(6));
    });

    it('rejects accessor-backed plan data without evaluating the accessor', () => {
        const expectedGetter = vi.fn(() => stateAtBeat(6));
        const accessorPlan = Object.defineProperties(
            {},
            {
                version: { enumerable: true, value: 1 },
                expected: { enumerable: true, get: expectedGetter },
                replacement: { enumerable: true, value: stateAtBeat(4) },
            }
        );

        expectRejectedWithoutWrite(accessorPlan, stateAtBeat(6));
        expect(expectedGetter).not.toHaveBeenCalled();
    });

    it('rejects revoked or throwing root and nested proxies without writing', () => {
        const revokedRoot = Proxy.revocable(plan(stateAtBeat(6), stateAtBeat(4)), {});
        revokedRoot.revoke();

        const throwingRoot = new Proxy(plan(stateAtBeat(6), stateAtBeat(4)), {
            ownKeys(): never {
                throw new Error('root ownKeys failed');
            },
        });

        const revokedExpected = Proxy.revocable(stateAtBeat(6), {});
        revokedExpected.revoke();

        const throwingPoint = new Proxy(point(6, 0.5), {
            getPrototypeOf(): never {
                throw new Error('nested prototype failed');
            },
        });
        const throwingNestedState: AutomationStoreState = {
            lanes: [lane({ points: [throwingPoint] })],
        };

        const malformedPlans = [
            revokedRoot.proxy,
            throwingRoot,
            plan(revokedExpected.proxy, stateAtBeat(4)),
            plan(throwingNestedState, stateAtBeat(4)),
        ];

        for (const malformedPlan of malformedPlans) {
            expectRejectedWithoutWrite(malformedPlan, stateAtBeat(6));
        }
    });

    it.each([
        { lanes: [], extra: true },
        { lanes: [lane({ maxValue: -1 })] },
        { lanes: [lane({ points: [{ ...point(4, 0.5), value: Number.NaN }] })] },
        { lanes: [{ ...lane(), points: [{ ...point(4, 0.5), curve: 'foreign' }] }] },
        { lanes: [lane({ objects: [{ ...lane().objects[0]!, endBeat: -1 }] })] },
    ])('rejects an invalid expected owner state', (expected) => {
        expectRejectedWithoutWrite(plan(expected, stateAtBeat(4)), stateAtBeat(6));
    });

    it.each([
        { lanes: [], extra: true },
        { lanes: [lane({ minValue: 2, maxValue: 1 })] },
        { lanes: [lane({ points: [{ ...point(4, 0.5), beat: Number.POSITIVE_INFINITY }] })] },
        { lanes: [lane({ trimPoints: [{ ...point(4, 0.5), tension: Number.NaN }] })] },
        { lanes: [lane({ ghostPoints: [{ ...point(4, 0.5), cp1: { x: Number.NaN, y: 0 } }] })] },
    ])('rejects an invalid replacement owner state', (replacement) => {
        expectRejectedWithoutWrite(plan(stateAtBeat(6), replacement), stateAtBeat(6));
    });

    it('rejects a non-plain nested owner state', () => {
        class AutomationState {
            lanes = [lane()];
        }

        expectRejectedWithoutWrite(plan(new AutomationState(), stateAtBeat(4)), stateAtBeat(6));
    });

    it('rejects an absent current owner state', () => {
        expectRejectedWithoutWrite(plan(stateAtBeat(6), stateAtBeat(4)), null);
    });

    it('closes after a stale captured reference even when the replacement current value is equal', () => {
        const currentState = stateAtBeat(6);
        const equivalentInterveningState = structuredClone(currentState);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));
        mocks.state.value = equivalentInterveningState;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(equivalentInterveningState);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = currentState;
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('fails closed when the captured current state is mutated in place before apply', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));
        const currentPoint = currentState.lanes[0]?.points[0];
        if (!currentPoint) {
            throw new Error('expected current fixture point');
        }
        currentPoint.beat = 8;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(currentState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('fails closed when the replacement is mutated in place during apply publication', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            const replacementPoint = nextState?.lanes[0]?.points[0];
            if (!replacementPoint) {
                throw new Error('expected replacement fixture point');
            }
            replacementPoint.beat = 10;
        });
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(replacementState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the published replacement is mutated in place before revert', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(true);
        const replacementPoint = replacementState.lanes[0]?.points[0];
        if (!replacementPoint) {
            throw new Error('expected replacement fixture point');
        }
        replacementPoint.beat = 10;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(replacementState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(transaction.revert()).toBe(false);
    });

    it('fails closed when the captured state is mutated in place before revert', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(true);
        const currentPoint = currentState.lanes[0]?.points[0];
        if (!currentPoint) {
            throw new Error('expected current fixture point');
        }
        currentPoint.beat = 8;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(replacementState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(transaction.revert()).toBe(false);
    });

    it('fails closed when the captured state is mutated during revert publication', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(true);
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            const currentPoint = nextState?.lanes[0]?.points[0];
            if (!currentPoint) {
                throw new Error('expected current fixture point');
            }
            currentPoint.beat = 8;
        });

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(currentState);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(transaction.revert()).toBe(false);
    });

    it('allows one ordered apply and revert only', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(true);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(true);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('closes after a stale replacement blocks revert', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        const foreignState = stateAtBeat(10);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(true);
        mocks.state.value = foreignState;
        const callsBeforeRevert = mocks.set.mock.calls.length;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(foreignState);
        expect(mocks.set).toHaveBeenCalledTimes(callsBeforeRevert);

        mocks.state.value = replacementState;
        expect(transaction.revert()).toBe(false);
    });

    it('closes when apply publication is replaced reentrantly by a subscriber', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        const subscriberState = stateAtBeat(8);
        mocks.state.value = currentState;
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            mocks.state.value = subscriberState;
        });
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(subscriberState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes when revert publication is replaced reentrantly by a subscriber', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        const subscriberState = stateAtBeat(8);
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));
        expect(transaction.apply()).toBe(true);
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            mocks.state.value = subscriberState;
        });

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(subscriberState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('closes after a setter throws during apply, preserving any completed setter effect', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        const publicationError = new Error('apply publication failed');
        mocks.state.value = currentState;
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            throw publicationError;
        });
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(() => transaction.apply()).toThrow(publicationError);
        expect(mocks.state.value).toBe(replacementState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('closes after a setter throws during revert, preserving any completed setter effect', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        const publicationError = new Error('revert publication failed');
        mocks.state.value = currentState;
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));
        expect(transaction.apply()).toBe(true);
        mocks.set.mockImplementationOnce((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
            throw publicationError;
        });

        expect(() => transaction.revert()).toThrow(publicationError);
        expect(mocks.state.value).toBe(currentState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
    });

    it('closes when a setter returns without publishing the replacement', () => {
        const currentState = stateAtBeat(6);
        const replacementState = stateAtBeat(4);
        mocks.state.value = currentState;
        mocks.set.mockImplementationOnce(() => {});
        const transaction = prepareAutomationTimeStateRestore(plan(structuredClone(currentState), replacementState));

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(currentState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });
});
