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

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

const { prepareAutomationTimeOperation } = await import('../prepareAutomationTimeOperation');

type PrepareInput = Parameters<typeof prepareAutomationTimeOperation>[0];
type OwnerSnapshot = PrepareInput['owners'][number];

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
        virginTerritory: true,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

function owner(trackId: string, eligible: boolean, clipIds: readonly string[]): OwnerSnapshot {
    return { trackId, eligible, clipIds };
}

function expectClosedWithoutWrite(input: PrepareInput, preparedState: AutomationStoreState): void {
    const transaction = prepareAutomationTimeOperation(input);

    expect(transaction.hasChanges).toBe(false);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.state.value).toBe(preparedState);
    expect(mocks.set).not.toHaveBeenCalled();
}

describe('prepareAutomationTimeOperation', () => {
    beforeEach(() => {
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('prepares without effects and inserts time only into eligible lanes', () => {
        const eligibleLane = lane({
            points: [point(3, 0.2), point(4, 0.4), point(6, 0.6)],
        });
        const dormantVcaLane = lane({
            id: 'lane-vca',
            trackId: 'track-vca',
            clipId: 'clip-vca',
            points: [point(4, 0.8)],
        });
        const preparedState: AutomationStoreState = { lanes: [eligibleLane, dormantVcaLane] };
        mocks.state.value = preparedState;

        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1']), owner('track-vca', false, ['clip-vca'])],
        });

        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        const appliedState = mocks.state.value;
        expect(appliedState.lanes[0]?.points.map(({ beat }) => beat)).toEqual([3, 6, 8]);
        expect(appliedState.lanes[0]?.trimPoints).toBe(eligibleLane.trimPoints);
        expect(appliedState.lanes[0]?.ghostPoints).toBe(eligibleLane.ghostPoints);
        expect(appliedState.lanes[0]?.objects).toBe(eligibleLane.objects);
        expect(appliedState.lanes[1]).toBe(dormantVcaLane);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('preserves the characterized delete boundaries for eligible lanes', () => {
        const beforePoint = point(2, 0.2);
        const endPoint = point(6, 0.6);
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [beforePoint, point(3, 0.3), point(4, 0.4), endPoint, point(8, 0.8)] })],
        };
        mocks.state.value = preparedState;

        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'delete', startBeat: 3, endBeat: 6 },
            owners: [owner('track-1', true, ['clip-1'])],
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = mocks.state.value;
        expect(appliedState.lanes[0]?.points.map(({ beat }) => beat)).toEqual([2, 3, 5]);
        expect(appliedState.lanes[0]?.points[0]).toBe(beforePoint);
        expect(appliedState.lanes[0]?.points[1]).not.toBe(endPoint);
    });

    it.each([
        {
            name: 'unknown track',
            state: { lanes: [lane({ trackId: 'unknown' })] },
            owners: [owner('track-1', true, ['clip-1'])],
        },
        {
            name: 'duplicate track owner',
            state: { lanes: [lane()] },
            owners: [owner('track-1', true, ['clip-1']), owner('track-1', true, ['clip-1'])],
        },
        {
            name: 'duplicate clip owner',
            state: { lanes: [lane()] },
            owners: [owner('track-1', true, ['clip-1']), owner('track-2', true, ['clip-1'])],
        },
        {
            name: 'contradictory clip owner',
            state: { lanes: [lane()] },
            owners: [owner('track-1', true, []), owner('track-2', true, ['clip-1'])],
        },
        {
            name: 'empty track id',
            state: { lanes: [lane()] },
            owners: [owner('', true, ['clip-1'])],
        },
    ])('rejects $name without applying a partial eligible subset', ({ state, owners }) => {
        const preparedState: AutomationStoreState = state;
        mocks.state.value = preparedState;

        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 0, durationBeats: 1 },
                owners,
            },
            preparedState
        );
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
    ])('rejects invalid operation $type before writing', (operation) => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;

        expectClosedWithoutWrite(
            {
                operation,
                owners: [owner('track-1', true, ['clip-1'])],
            },
            preparedState
        );
    });

    it('rejects a finite insert whose resulting point beat overflows', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(Number.MAX_VALUE, 0.5)] })],
        };
        mocks.state.value = preparedState;

        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 0, durationBeats: Number.MAX_VALUE },
                owners: [owner('track-1', true, ['clip-1'])],
            },
            preparedState
        );
    });

    it.each([
        {
            name: 'insert',
            operation: { type: 'insert' as const, atBeat: 0, durationBeats: 1 },
        },
        {
            name: 'delete',
            operation: { type: 'delete' as const, startBeat: 0, endBeat: 1 },
        },
    ])('reports no change when $name rounding preserves the beat', ({ operation }) => {
        const unchangedPoint = point(Number.MAX_VALUE, 0.5);
        const unchangedLane = lane({ points: [unchangedPoint] });
        const preparedState: AutomationStoreState = { lanes: [unchangedLane] };
        mocks.state.value = preparedState;

        expectClosedWithoutWrite(
            {
                operation,
                owners: [owner('track-1', true, ['clip-1'])],
            },
            preparedState
        );
        expect(mocks.state.value.lanes[0]).toBe(unchangedLane);
        expect(mocks.state.value.lanes[0]?.points[0]).toBe(unchangedPoint);
    });

    it('reports truthful no-change for missing, empty, and ineligible owner state', () => {
        const missingTransaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [],
        });
        expect(missingTransaction.hasChanges).toBe(false);
        expect(missingTransaction.apply()).toBe(false);

        const emptyState: AutomationStoreState = { lanes: [] };
        mocks.state.value = emptyState;
        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
                owners: [],
            },
            emptyState
        );

        const unchangedLane = lane({ points: [point(1, 0.25)] });
        const unchangedState: AutomationStoreState = { lanes: [unchangedLane] };
        mocks.state.value = unchangedState;
        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
                owners: [owner('track-1', true, ['clip-1'])],
            },
            unchangedState
        );
        expect(mocks.state.value.lanes[0]).toBe(unchangedLane);

        const dormantLane = lane({ trackId: 'track-vca', clipId: 'clip-vca', points: [point(4, 0.5)] });
        const dormantState: AutomationStoreState = { lanes: [dormantLane] };
        mocks.state.value = dormantState;
        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
                owners: [owner('track-vca', false, ['clip-vca'])],
            },
            dormantState
        );
        expect(mocks.state.value.lanes[0]).toBe(dormantLane);
    });

    it('refuses stale apply and closes the handle', () => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;
        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });
        const interveningState: AutomationStoreState = { lanes: [...preparedState.lanes] };
        mocks.state.value = interveningState;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(interveningState);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = preparedState;
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('reverts to the exact captured state and refuses intervening state', () => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;
        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(true);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(transaction.revert()).toBe(false);

        mocks.state.value = preparedState;
        const staleRevertTransaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });
        expect(staleRevertTransaction.apply()).toBe(true);
        const interveningState: AutomationStoreState = { lanes: [lane({ points: [point(12, 0.9)] })] };
        mocks.state.value = interveningState;
        const callsBeforeStaleRevert = mocks.set.mock.calls.length;

        expect(staleRevertTransaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(interveningState);
        expect(mocks.set).toHaveBeenCalledTimes(callsBeforeStaleRevert);
    });

    it('closes after apply or revert publication failure without inventing inverse state', () => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;
        const applyFailure = new Error('apply failed');
        mocks.set.mockImplementationOnce(() => {
            throw applyFailure;
        });
        const failedApply = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });

        expect(() => failedApply.apply()).toThrow(applyFailure);
        expect(mocks.state.value).toBe(preparedState);
        expect(failedApply.apply()).toBe(false);
        expect(failedApply.revert()).toBe(false);

        mocks.set.mockImplementation((nextState: AutomationStoreState | null): void => {
            mocks.state.value = nextState;
        });
        const failedRevert = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });
        expect(failedRevert.apply()).toBe(true);
        const appliedState = mocks.state.value;
        const revertFailure = new Error('revert failed');
        mocks.set.mockImplementationOnce(() => {
            throw revertFailure;
        });

        expect(() => failedRevert.revert()).toThrow(revertFailure);
        expect(mocks.state.value).toBe(appliedState);
        expect(failedRevert.revert()).toBe(false);
        expect(failedRevert.apply()).toBe(false);
    });
});
