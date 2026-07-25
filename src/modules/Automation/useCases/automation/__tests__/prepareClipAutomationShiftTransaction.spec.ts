import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane, AutomationPoint } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

const { prepareClipAutomationShiftTransaction } = await import('../prepareClipAutomationShiftTransaction');
const { shiftClipAutomation } = await import('../shiftClipAutomation');

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
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [],
        trimPoints: [point(0.25, 0.1)],
        objects: [
            {
                id: 'object-1',
                laneId: 'lane-1',
                startBeat: 0.5,
                endBeat: 1.5,
                points: [point(0.75, 0.2)],
                name: 'Object',
            },
        ],
        ghostPoints: [point(0.5, 0.3)],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

describe('prepareClipAutomationShiftTransaction', () => {
    beforeEach(() => {
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: AutomationStoreState): void => {
            mocks.state.value = nextState;
        });
    });

    it('prepares without effects and applies the complete characterized shift exactly once', () => {
        const matchingLane = lane({
            points: [point(3, 0.8), point(0.5, 0.2)],
        });
        const secondMatchingLane = lane({
            id: 'lane-2',
            parameterId: 'pan',
            parameterName: 'Pan',
            points: [point(1.5, 0.4)],
        });
        const unrelatedLane = lane({
            id: 'lane-3',
            clipId: 'clip-2',
            points: [point(4, 0.6)],
        });
        const preparedState: AutomationStoreState = {
            lanes: [matchingLane, secondMatchingLane, unrelatedLane],
        };
        mocks.state.value = preparedState;

        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: -1,
        });

        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(preparedState.lanes[0]?.points.map(({ beat }) => beat)).toEqual([3, 0.5]);

        expect(transaction.apply()).toBe(true);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(mocks.state.value.lanes[0]?.points.map(({ beat }) => beat)).toEqual([0, 2]);
        expect(mocks.state.value.lanes[1]?.points.map(({ beat }) => beat)).toEqual([0.5]);
        expect(mocks.state.value.lanes[2]).toBe(unrelatedLane);
        expect(mocks.state.value.lanes[0]?.trimPoints).toBe(matchingLane.trimPoints);
        expect(mocks.state.value.lanes[0]?.ghostPoints).toBe(matchingLane.ghostPoints);
        expect(mocks.state.value.lanes[0]?.objects).toBe(matchingLane.objects);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('refuses an apply when the store object identity changed after preparation', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(2, 0.5)] })],
        };
        mocks.state.value = preparedState;
        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });

        const sameContentWithNewIdentity: AutomationStoreState = {
            lanes: [...preparedState.lanes],
        };
        mocks.state.value = sameContentWithNewIdentity;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(sameContentWithNewIdentity);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = preparedState;
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'returns an exact no-change handle for non-finite delta %s',
        (beatDelta) => {
            const preparedState: AutomationStoreState = {
                lanes: [lane({ points: [point(2, 0.5)] })],
            };
            mocks.state.value = preparedState;

            const transaction = prepareClipAutomationShiftTransaction({
                clipId: 'clip-1',
                beatDelta,
            });

            expect(transaction.hasChanges).toBe(false);
            expect(transaction.apply()).toBe(false);
            expect(transaction.revert()).toBe(false);
            expect(mocks.state.value).toBe(preparedState);
            expect(mocks.set).not.toHaveBeenCalled();
        }
    );

    it('fails closed when a finite point beat plus a finite delta overflows', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(Number.MAX_VALUE, 0.5), point(1, 0.25)] })],
        };
        mocks.state.value = preparedState;

        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: Number.MAX_VALUE,
        });

        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('reports no change when state is missing, the clip has no lane, or clamping preserves every beat', () => {
        const missingStateTransaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });
        expect(missingStateTransaction.hasChanges).toBe(false);
        expect(missingStateTransaction.apply()).toBe(false);

        const noMatchingLaneState: AutomationStoreState = {
            lanes: [lane({ clipId: 'clip-2', points: [point(2, 0.5)] })],
        };
        mocks.state.value = noMatchingLaneState;
        const noMatchingLaneTransaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });
        expect(noMatchingLaneTransaction.hasChanges).toBe(false);
        expect(noMatchingLaneTransaction.apply()).toBe(false);

        const clampedState: AutomationStoreState = {
            lanes: [lane({ points: [point(0, 0.5)] })],
        };
        mocks.state.value = clampedState;
        const clampedTransaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: -1,
        });
        expect(clampedTransaction.hasChanges).toBe(false);
        expect(clampedTransaction.apply()).toBe(false);
        expect(clampedTransaction.revert()).toBe(false);

        expect(mocks.state.value).toBe(clampedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('restores the captured state identity after a clamped forward shift', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(0.25, 0.5), point(2, 0.8)] })],
        };
        mocks.state.value = preparedState;
        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: -1,
        });

        expect(transaction.apply()).toBe(true);
        expect(mocks.state.value.lanes[0]?.points.map(({ beat }) => beat)).toEqual([0, 1]);
        expect(transaction.revert()).toBe(true);

        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.state.value.lanes[0]?.points.map(({ beat }) => beat)).toEqual([0.25, 2]);
        expect(mocks.set).toHaveBeenNthCalledWith(2, preparedState);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('preserves state and closes the handle when publishing the apply throws', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(1, 0.5)] })],
        };
        const failure = new Error('write failed');
        mocks.state.value = preparedState;
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });
        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });

        expect(() => transaction.apply()).toThrow(failure);
        expect(mocks.state.value).toBe(preparedState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('preserves the applied state and closes the handle when publishing the revert throws', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(1, 0.5)] })],
        };
        const failure = new Error('rollback failed');
        mocks.state.value = preparedState;
        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = mocks.state.value;
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => transaction.revert()).toThrow(failure);
        expect(mocks.state.value).toBe(appliedState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('rejects out-of-order calls and refuses to overwrite state changed after apply', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(1, 0.5)] })],
        };
        mocks.state.value = preparedState;
        const transaction = prepareClipAutomationShiftTransaction({
            clipId: 'clip-1',
            beatDelta: 1,
        });

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(true);
        const interveningState: AutomationStoreState = {
            lanes: [lane({ points: [point(9, 0.9)] })],
        };
        mocks.state.value = interveningState;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(interveningState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('leaves the existing shift behavior characterized and unchanged', () => {
        const matchingLane = lane({
            points: [point(3, 0.8), point(0.25, 0.2)],
        });
        const unrelatedLane = lane({
            id: 'lane-2',
            clipId: 'clip-2',
            points: [point(4, 0.6)],
        });
        mocks.state.value = { lanes: [matchingLane, unrelatedLane] };

        shiftClipAutomation('clip-1', -1);

        expect(mocks.state.value.lanes[0]?.points.map(({ beat }) => beat)).toEqual([0, 2]);
        expect(mocks.state.value.lanes[0]?.trimPoints).toBe(matchingLane.trimPoints);
        expect(mocks.state.value.lanes[0]?.ghostPoints).toBe(matchingLane.ghostPoints);
        expect(mocks.state.value.lanes[0]?.objects).toBe(matchingLane.objects);
        expect(mocks.state.value.lanes[1]).toBe(unrelatedLane);
    });
});
