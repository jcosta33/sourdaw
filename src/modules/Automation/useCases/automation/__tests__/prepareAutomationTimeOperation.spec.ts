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
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

function owner(trackId: string, eligible: boolean, clipIds: readonly string[]): OwnerSnapshot {
    return { trackId, eligible, clipIds };
}

function prepareRuntimeInput(input: unknown): ReturnType<typeof prepareAutomationTimeOperation> {
    return prepareAutomationTimeOperation(input as PrepareInput);
}

function expectClosedWithoutWrite(
    input: PrepareInput,
    preparedState: AutomationStoreState,
    expectedStatus: 'ready' | 'rejected'
): void {
    const transaction = prepareAutomationTimeOperation(input);

    expect(transaction).toHaveProperty('status', expectedStatus);
    expect(transaction.hasChanges).toBe(false);
    expect(transaction.inversePlan).toBeNull();
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

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(true);
        const inversePlan = transaction.inversePlan;
        expect(inversePlan).not.toBeNull();
        if (!inversePlan) {
            throw new Error('expected inverse plan');
        }
        expect(inversePlan.version).toBe(1);
        expect(inversePlan.expected).toEqual({
            lanes: [
                {
                    ...eligibleLane,
                    points: [point(3, 0.2), point(6, 0.4), point(8, 0.6)],
                },
                dormantVcaLane,
            ],
        });
        expect(inversePlan.replacement).toEqual(preparedState);
        expect(inversePlan.expected).not.toBe(preparedState);
        expect(inversePlan.replacement).not.toBe(preparedState);
        expect(inversePlan.expected.lanes[0]).not.toBe(eligibleLane);
        expect(inversePlan.replacement.lanes[0]).not.toBe(eligibleLane);
        expect(inversePlan.expected.lanes[1]).not.toBe(inversePlan.replacement.lanes[1]);
        const roundTrippedPlan: unknown = JSON.parse(JSON.stringify(inversePlan));
        expect(roundTrippedPlan).toEqual(inversePlan);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        const appliedState = mocks.state.value;
        expect(appliedState.lanes[0]?.points.map(({ beat }) => beat)).toEqual([3, 6, 8]);
        expect(appliedState.lanes[0]?.trimPoints).toBe(eligibleLane.trimPoints);
        expect(appliedState.lanes[0]?.ghostPoints).toBe(eligibleLane.ghostPoints);
        expect(appliedState.lanes[0]?.objects).toBe(eligibleLane.objects);
        expect(appliedState.lanes[1]).toBe(dormantVcaLane);
        expect(appliedState).not.toBe(inversePlan.expected);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('drops the clip-scoped lanes of retired clip ids and keeps their inverse snapshot', () => {
        const retiredLane = lane({ id: 'lane-retired', clipId: 'clip-retired', points: [point(3, 0.2)] });
        const survivingLane = lane({ id: 'lane-surviving', clipId: 'clip-1', points: [point(3, 0.2)] });
        const trackLane = lane({ id: 'lane-track', clipId: undefined, points: [point(3, 0.2)] });
        const preparedState: AutomationStoreState = { lanes: [retiredLane, survivingLane, trackLane] };
        mocks.state.value = preparedState;

        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'delete', startBeat: 0, endBeat: 2 },
            owners: [owner('track-1', true, ['clip-1', 'clip-retired'])],
            removedClipIds: ['clip-retired'],
        });

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(mocks.state.value?.lanes.map((entry) => entry.id)).toEqual(['lane-surviving', 'lane-track']);

        // Undo has to bring the retired lane back, so the inverse snapshot keeps it.
        expect(transaction.inversePlan?.replacement).toEqual(preparedState);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
    });

    it('rejects a malformed retired clip id list before touching state', () => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(3, 0.2)] })] };
        mocks.state.value = preparedState;

        const transaction = prepareRuntimeInput({
            operation: { type: 'delete', startBeat: 0, endBeat: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
            removedClipIds: ['clip-1', 7],
        });

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('preserves every Automation state field in independent inverse-plan snapshots', () => {
        const richPoint: AutomationPoint = {
            beat: 4,
            value: 0.5,
            curve: 'bezier',
            tension: 0.25,
            stairSteps: 6,
            cp1: { x: 0.2, y: 0.3 },
            cp2: { x: 0.8, y: 0.7 },
        };
        const richLane = lane({
            clipAutomationMode: 'multiplicative',
            points: [richPoint],
            objects: [
                {
                    id: 'object-rich',
                    laneId: 'lane-1',
                    startBeat: 1,
                    endBeat: 3,
                    points: [richPoint],
                    poolId: 'pool-1',
                    loopLength: 2,
                    overrides: { gain: true, pan: false },
                    name: 'Rich object',
                },
            ],
            linkedLaneId: 'lane-source',
            linkScale: -1,
            viewMinValue: 0.1,
            viewMaxValue: 0.9,
            color: '#abcdef',
        });
        const preparedState: AutomationStoreState = { lanes: [richLane] };
        mocks.state.value = preparedState;

        const transaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, ['clip-1'])],
        });
        const inversePlan = transaction.inversePlan;

        expect(transaction).toHaveProperty('status', 'ready');
        expect(transaction.hasChanges).toBe(true);
        expect(inversePlan).not.toBeNull();
        if (!inversePlan) {
            throw new Error('expected inverse plan');
        }
        expect(inversePlan.replacement).toEqual(preparedState);
        expect(inversePlan.expected).toEqual({
            lanes: [
                {
                    ...richLane,
                    points: [{ ...richPoint, beat: 6 }],
                },
            ],
        });
        expect(inversePlan.replacement.lanes[0]).not.toBe(richLane);
        expect(inversePlan.replacement.lanes[0]?.points[0]).not.toBe(richPoint);
        expect(inversePlan.expected.lanes[0]?.objects[0]).not.toBe(richLane.objects[0]);
        expect(inversePlan.expected.lanes[0]?.objects[0]?.overrides).not.toBe(richLane.objects[0]?.overrides);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
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

        expect(transaction).toHaveProperty('status', 'ready');
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
            name: 'unknown clip owner',
            state: { lanes: [lane()] },
            owners: [owner('track-1', true, ['clip-2'])],
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
            preparedState,
            'rejected'
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
            preparedState,
            'rejected'
        );
    });

    it.each([
        undefined,
        null,
        [],
        new Date(0),
        {},
        { operation: { type: 'insert', atBeat: 0, durationBeats: 1 } },
        { owners: [] },
        { operation: { type: 'insert', atBeat: 0, durationBeats: 1 }, owners: {} },
    ])('rejects a malformed runtime root without throwing or writing', (input) => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;

        const transaction = prepareRuntimeInput(input);

        expect(transaction).toHaveProperty('status', 'rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it.each([
        null,
        [],
        new Date(0),
        {},
        { type: 'unknown' },
        { type: 'insert', atBeat: '0', durationBeats: 1 },
        { type: 'insert', atBeat: 0, durationBeats: '1' },
        { type: 'delete', startBeat: '0', endBeat: 1 },
        { type: 'delete', startBeat: 0, endBeat: '1' },
    ])('rejects malformed runtime operation data without writing', (operation) => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;

        const transaction = prepareRuntimeInput({
            operation,
            owners: [owner('track-1', true, ['clip-1'])],
        });

        expect(transaction).toHaveProperty('status', 'rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it.each([
        [null],
        [[]],
        [new Date(0)],
        [{}],
        [{ trackId: 1, eligible: true, clipIds: ['clip-1'] }],
        [{ trackId: 'track-1', eligible: 'yes', clipIds: ['clip-1'] }],
        [{ trackId: 'track-1', eligible: true, clipIds: {} }],
        [{ trackId: 'track-1', eligible: true, clipIds: [''] }],
        [{ trackId: 'track-1', eligible: true, clipIds: ['clip-1', 'clip-1'] }],
    ])('rejects malformed runtime owner rows without writing', (owners) => {
        const preparedState: AutomationStoreState = { lanes: [lane({ points: [point(4, 0.5)] })] };
        mocks.state.value = preparedState;

        const transaction = prepareRuntimeInput({
            operation: { type: 'insert', atBeat: 0, durationBeats: 1 },
            owners,
        });

        expect(transaction).toHaveProperty('status', 'rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
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
            preparedState,
            'rejected'
        );
    });

    it('rejects a delete whose resulting point beat is non-finite', () => {
        const preparedState: AutomationStoreState = {
            lanes: [lane({ points: [point(Number.POSITIVE_INFINITY, 0.5)] })],
        };
        mocks.state.value = preparedState;

        expectClosedWithoutWrite(
            {
                operation: { type: 'delete', startBeat: 0, endBeat: 1 },
                owners: [owner('track-1', true, ['clip-1'])],
            },
            preparedState,
            'rejected'
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
            preparedState,
            'ready'
        );
        expect(mocks.state.value.lanes[0]).toBe(unchangedLane);
        expect(mocks.state.value.lanes[0]?.points[0]).toBe(unchangedPoint);
    });

    it('distinguishes missing state from valid empty and ineligible no-change', () => {
        const missingTransaction = prepareAutomationTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [],
        });
        expect(missingTransaction).toHaveProperty('status', 'rejected');
        expect(missingTransaction.hasChanges).toBe(false);
        expect(missingTransaction.inversePlan).toBeNull();
        expect(missingTransaction.apply()).toBe(false);
        expect(missingTransaction.revert()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();

        const emptyState: AutomationStoreState = { lanes: [] };
        mocks.state.value = emptyState;
        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
                owners: [],
            },
            emptyState,
            'ready'
        );

        const unchangedLane = lane({ points: [point(1, 0.25)] });
        const unchangedState: AutomationStoreState = { lanes: [unchangedLane] };
        mocks.state.value = unchangedState;
        expectClosedWithoutWrite(
            {
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
                owners: [owner('track-1', true, ['clip-1'])],
            },
            unchangedState,
            'ready'
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
            dormantState,
            'ready'
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
