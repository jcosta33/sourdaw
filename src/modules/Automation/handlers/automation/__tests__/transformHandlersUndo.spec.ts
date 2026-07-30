import { describe, it, expect, beforeEach } from 'vitest';

import { type AppAction, type HandlerDescribeResult } from '#/utils/handlerContract';

import { createAutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { handleAddAutomationLane } from '../handleAddAutomationLane';
import { handleInvertAutomation } from '../handleInvertAutomation';
import { handleQuantizeAutomation } from '../handleQuantizeAutomation';
import { handleRemoveAutomationLane } from '../handleRemoveAutomationLane';
import { handleRestoreAutomationLanePoints } from '../handleRestoreAutomationLanePoints';
import { handleReverseAutomation } from '../handleReverseAutomation';
import { handleScaleAutomation } from '../handleScaleAutomation';
import { handleStretchAutomation } from '../handleStretchAutomation';
import { handleThinAutomation } from '../handleThinAutomation';

const LANE_ID = 'lane-1';

function seedLane(points: AutomationPoint[]): AutomationPoint[] {
    const snapshot = points.map((p) => ({ ...p }));
    automationStore.set({
        lanes: [
            {
                id: LANE_ID,
                trackId: 't1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: snapshot.map((p) => ({ ...p })),
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
    return snapshot;
}

function currentPoints(): AutomationPoint[] {
    return automationStore.value!.lanes.find((l) => l.id === LANE_ID)!.points;
}

function applyInverse(inverse: AppAction | null | undefined): boolean {
    if (!inverse) {
        return false;
    }
    if (inverse.type !== 'restoreAutomationLanePoints') {
        throw new Error(`Unexpected inverse: ${inverse.type}`);
    }
    expect(handleRestoreAutomationLanePoints.execute(inverse)).toEqual({ status: 'written' });
    return true;
}

describe('automation transform handlers — execute → undo restores pre-state', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    const cases: Array<{
        name: string;
        run: () => { describeResult: HandlerDescribeResult; before: AutomationPoint[] };
    }> = [
        {
            name: 'handleReverseAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0.9, curve: 'exponential', tension: 0.5 },
                ]);
                const action = { type: 'reverseAutomation' as const, payload: { laneId: LANE_ID } };
                const describeResult = handleReverseAutomation.describe(action);
                void handleReverseAutomation.execute(action);
                return { describeResult, before };
            },
        },
        {
            name: 'handleScaleAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                    { beat: 2, value: 0.6, curve: 'linear', tension: 0 },
                ]);
                const action = {
                    type: 'scaleAutomation' as const,
                    payload: { laneId: LANE_ID, factor: 2, anchor: 0.1 },
                };
                const describeResult = handleScaleAutomation.describe(action);
                void handleScaleAutomation.execute(action);
                return { describeResult, before };
            },
        },
        {
            name: 'handleStretchAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 1, value: 0.3, curve: 'linear', tension: 0 },
                    { beat: 5, value: 0.7, curve: 's-curve', tension: -0.2 },
                ]);
                const action = {
                    type: 'stretchAutomation' as const,
                    payload: { laneId: LANE_ID, factor: 1.5, anchorBeat: 0 },
                };
                const describeResult = handleStretchAutomation.describe(action);
                void handleStretchAutomation.execute(action);
                return { describeResult, before };
            },
        },
        {
            name: 'handleThinAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 0, value: 0, curve: 'linear', tension: 0 },
                    { beat: 1, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 2, value: 1, curve: 'linear', tension: 0 },
                    { beat: 3, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0, curve: 'linear', tension: 0 },
                ]);
                const action = { type: 'thinAutomation' as const, payload: { laneId: LANE_ID, tolerance: 0.5 } };
                const describeResult = handleThinAutomation.describe(action);
                void handleThinAutomation.execute(action);
                return { describeResult, before };
            },
        },
        {
            name: 'handleQuantizeAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 0.1, value: 0.2, curve: 'linear', tension: 0 },
                    { beat: 0.9, value: 0.4, curve: 'linear', tension: 0 },
                    { beat: 2.1, value: 0.8, curve: 'linear', tension: 0 },
                ]);
                const action = { type: 'quantizeAutomation' as const, payload: { laneId: LANE_ID, gridSize: 1 } };
                const describeResult = handleQuantizeAutomation.describe(action);
                void handleQuantizeAutomation.execute(action);
                return { describeResult, before };
            },
        },
        {
            name: 'handleInvertAutomation',
            run: () => {
                const before = seedLane([
                    { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0.9, curve: 'linear', tension: 0 },
                ]);
                const action = { type: 'invertAutomation' as const, payload: { laneId: LANE_ID } };
                const describeResult = handleInvertAutomation.describe(action);
                void handleInvertAutomation.execute(action);
                return { describeResult, before };
            },
        },
    ];

    for (const { name, run } of cases) {
        it(`${name}: emits an inverse that restores the exact pre-state`, () => {
            const { describeResult, before } = run();

            // The transform mutated the lane (otherwise the test would not prove undo).
            expect(currentPoints()).not.toEqual(before);

            expect(describeResult.inverseAction).toMatchObject({
                payload: { expectedPoints: currentPoints() },
            });

            // The handler captured a real inverse (the MAJOR regression: this was null,
            // making undo an inert no-op).
            const undone = applyInverse(describeResult.inverseAction);
            expect(undone).toBe(true);

            // Undo restored the exact pre-state, including curve/tension per point.
            expect(currentPoints()).toEqual(before);
        });
    }

    it('rejects a stale transform inverse without deleting later lane edits', () => {
        seedLane([
            { id: 'point-a', beat: 0, value: 0.2, curve: 'linear', tension: 0 },
            { id: 'point-b', beat: 2, value: 0.6, curve: 'linear', tension: 0 },
        ]);
        const action = { type: 'scaleAutomation' as const, payload: { laneId: LANE_ID, factor: 1.5 } };
        const description = handleScaleAutomation.describe(action);
        void handleScaleAutomation.execute(action);
        const transformed = currentPoints().map((point) => ({ ...point }));
        expect(description.inverseAction).toMatchObject({
            payload: { expectedPoints: transformed },
        });

        const laterPoint: AutomationPoint = {
            id: 'later-point',
            beat: 4,
            value: 0.9,
            curve: 'linear',
            tension: 0,
        };
        const state = automationStore.value!;
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === LANE_ID ? { ...lane, points: [...lane.points, laterPoint] } : lane
            ),
        });

        const inverse = description.inverseAction;
        if (inverse?.type !== 'restoreAutomationLanePoints') {
            throw new Error('Expected restoreAutomationLanePoints inverse');
        }
        expect(handleRestoreAutomationLanePoints.execute(inverse)).toEqual({ status: 'conflict' });
        expect(currentPoints()).toContainEqual(laterPoint);
    });

    it('relies on transaction rollback instead of replaying stale inverses after batch abort', () => {
        expect(
            [
                handleScaleAutomation,
                handleStretchAutomation,
                handleInvertAutomation,
                handleReverseAutomation,
                handleThinAutomation,
                handleQuantizeAutomation,
            ].every((handler) => handler.requiresAbortCompensation === false)
        ).toBe(true);
    });

    it('treats transforms as no-ops when their target lane is missing', () => {
        automationStore.set({ lanes: [] });

        expect(
            handleScaleAutomation.isNoop?.({
                type: 'scaleAutomation',
                payload: { laneId: 'missing', factor: 2 },
            })
        ).toBe(true);
        expect(
            handleStretchAutomation.isNoop?.({
                type: 'stretchAutomation',
                payload: { laneId: 'missing', factor: 2 },
            })
        ).toBe(true);
        expect(
            handleInvertAutomation.isNoop?.({
                type: 'invertAutomation',
                payload: { laneId: 'missing' },
            })
        ).toBe(true);
        expect(
            handleReverseAutomation.isNoop?.({
                type: 'reverseAutomation',
                payload: { laneId: 'missing' },
            })
        ).toBe(true);
        expect(
            handleThinAutomation.isNoop?.({
                type: 'thinAutomation',
                payload: { laneId: 'missing', tolerance: 0.1 },
            })
        ).toBe(true);
        expect(
            handleQuantizeAutomation.isNoop?.({
                type: 'quantizeAutomation',
                payload: { laneId: 'missing', gridSize: 1 },
            })
        ).toBe(true);
    });

    it('treats empty lanes as no-ops for every transform', () => {
        seedLane([]);

        expect(
            handleScaleAutomation.isNoop?.({
                type: 'scaleAutomation',
                payload: { laneId: LANE_ID, factor: 2 },
            })
        ).toBe(true);
        expect(
            handleStretchAutomation.isNoop?.({
                type: 'stretchAutomation',
                payload: { laneId: LANE_ID, factor: 2 },
            })
        ).toBe(true);
        expect(
            handleInvertAutomation.isNoop?.({
                type: 'invertAutomation',
                payload: { laneId: LANE_ID },
            })
        ).toBe(true);
        expect(
            handleReverseAutomation.isNoop?.({
                type: 'reverseAutomation',
                payload: { laneId: LANE_ID },
            })
        ).toBe(true);
        expect(
            handleThinAutomation.isNoop?.({
                type: 'thinAutomation',
                payload: { laneId: LANE_ID, tolerance: 0.1 },
            })
        ).toBe(true);
        expect(
            handleQuantizeAutomation.isNoop?.({
                type: 'quantizeAutomation',
                payload: { laneId: LANE_ID, gridSize: 1 },
            })
        ).toBe(true);
    });

    it('uses point-count guards only when the transform cannot change the lane', () => {
        seedLane([{ beat: 3, value: 0.25, curve: 'linear', tension: 0 }]);

        expect(
            handleScaleAutomation.isNoop?.({
                type: 'scaleAutomation',
                payload: { laneId: LANE_ID, factor: 2 },
            })
        ).toBe(false);
        expect(
            handleStretchAutomation.isNoop?.({
                type: 'stretchAutomation',
                payload: { laneId: LANE_ID, factor: 2, anchorBeat: 0 },
            })
        ).toBe(false);
        expect(
            handleInvertAutomation.isNoop?.({
                type: 'invertAutomation',
                payload: { laneId: LANE_ID },
            })
        ).toBe(false);
        expect(
            handleQuantizeAutomation.isNoop?.({
                type: 'quantizeAutomation',
                payload: { laneId: LANE_ID, gridSize: 2 },
            })
        ).toBe(false);
        expect(
            handleReverseAutomation.isNoop?.({
                type: 'reverseAutomation',
                payload: { laneId: LANE_ID },
            })
        ).toBe(true);
        expect(
            handleThinAutomation.isNoop?.({
                type: 'thinAutomation',
                payload: { laneId: LANE_ID, tolerance: 0.1 },
            })
        ).toBe(true);

        seedLane([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 1, value: 0.5, curve: 'linear', tension: 0 },
        ]);
        expect(
            handleThinAutomation.isNoop?.({
                type: 'thinAutomation',
                payload: { laneId: LANE_ID, tolerance: 0.1 },
            })
        ).toBe(true);
        expect(
            handleReverseAutomation.isNoop?.({
                type: 'reverseAutomation',
                payload: { laneId: LANE_ID },
            })
        ).toBe(false);
    });

    it('treats identity scale and stretch factors as no-ops', () => {
        seedLane([
            { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
            { beat: 2, value: 0.8, curve: 'linear', tension: 0 },
        ]);

        expect(
            handleScaleAutomation.isNoop?.({
                type: 'scaleAutomation',
                payload: { laneId: LANE_ID, factor: 1, anchor: 0.5 },
            })
        ).toBe(true);
        expect(
            handleStretchAutomation.isNoop?.({
                type: 'stretchAutomation',
                payload: { laneId: LANE_ID, factor: 1, anchorBeat: 1 },
            })
        ).toBe(true);
    });

    it('handleAddAutomationLane: undo removes only its allocated lane under a duplicate target', () => {
        automationStore.set({ lanes: [] });
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't9', parameterId: 'pan', parameterName: 'Pan' },
        };
        const describeResult = handleAddAutomationLane.describe(action);
        void handleAddAutomationLane.execute(action);

        const inverse = describeResult.inverseAction;
        expect(inverse?.type).toBe('removeAutomationLane');
        if (inverse?.type !== 'removeAutomationLane' || !('laneId' in inverse.payload)) {
            throw new Error('Expected id-scoped removeAutomationLane inverse');
        }
        expect(typeof inverse.payload.laneId).toBe('string');
        expect(action.payload).toHaveProperty('laneId', inverse.payload.laneId);

        const addedLane = automationStore.value!.lanes[0]!;
        expect(addedLane.id).toBe(inverse.payload.laneId);

        const concurrentLane = {
            ...createAutomationLane('t9', 'pan', 'Concurrent pan'),
            id: 'concurrent-lane',
        };
        automationStore.set({ lanes: [...automationStore.value!.lanes, concurrentLane] });

        void handleRemoveAutomationLane.execute(inverse);

        expect(automationStore.value?.lanes).toEqual([concurrentLane]);

        expect(handleAddAutomationLane.isNoop?.(action)).toBe(true);
        expect(action.payload).toHaveProperty('laneId', concurrentLane.id);
        void handleAddAutomationLane.execute(action);
        expect(automationStore.value?.lanes).toEqual([concurrentLane]);
    });

    it('handleAddAutomationLane: omits the inverse when the lane already exists (no-op execute)', () => {
        seedLane([{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }]);
        // Lane (t1, gain) already exists from seedLane.
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain' },
        };
        const describeResult = handleAddAutomationLane.describe(action);
        // No inverse: execute is a no-op (duplicate guard), so undoing must not
        // remove the pre-existing lane.
        expect(describeResult.inverseAction ?? null).toBeNull();
    });

    it('handleAddAutomationLane: undo removes only the added track lane when a clip lane coexists', () => {
        const clipLane = createAutomationLane('t9', 'pan', 'Pan', 0, 1, 'clip-1');
        automationStore.set({ lanes: [clipLane] });
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't9', parameterId: 'pan', parameterName: 'Pan' },
        };

        const describeResult = handleAddAutomationLane.describe(action);
        void handleAddAutomationLane.execute(action);

        expect(automationStore.value?.lanes).toHaveLength(2);
        const inverse = describeResult.inverseAction;
        expect(inverse?.type).toBe('removeAutomationLane');
        if (inverse?.type !== 'removeAutomationLane') {
            throw new Error('Expected removeAutomationLane inverse');
        }
        void handleRemoveAutomationLane.execute(inverse);
        expect(automationStore.value?.lanes).toEqual([clipLane]);
    });
});
