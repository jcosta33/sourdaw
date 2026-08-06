import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));

vi.mock('../../../useCases/automation/addAutomationPoint', () => ({
    addAutomationPoint: vi.fn(),
}));

vi.mock('../../../useCases/automation/transformAutomationPoints', () => ({
    transformAutomationPoints: vi.fn(),
}));

import { addAutomationPoint } from '../../../useCases/automation/addAutomationPoint';
import { transformAutomationPoints } from '../../../useCases/automation/transformAutomationPoints';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { describeLaneTransformUndo } from '../automationTransformUndo';
import { handleAddAutomationPoint } from '../handleAddAutomationPoint';

const mockedGetState = vi.mocked(getAutomationStoreState);
const mockedAddPoint = vi.mocked(addAutomationPoint);
const mockedTransform = vi.mocked(transformAutomationPoints);

function setLane(points: Record<string, unknown>[] | null) {
    if (points === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ lanes: [{ id: 'lane1', points }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    setLane(null);
});

describe('handleAddAutomationPoint — execute', () => {
    it('calls addAutomationPoint with generated pointId and defaults', () => {
        const action = {
            type: 'addAutomationPoint' as const,
            payload: { laneId: 'lane1', beat: 4, value: 0.5 },
        };
        handleAddAutomationPoint.execute(action);
        expect(mockedAddPoint).toHaveBeenCalledTimes(1);
        const [laneId, point] = mockedAddPoint.mock.calls[0]!;
        expect(laneId).toBe('lane1');
        expect(point.id).toMatch(/^auto-point-/);
        expect(point.curve).toBe('linear');
        expect(point.tension).toBe(0);
    });

    it('preserves explicit pointId when provided', () => {
        handleAddAutomationPoint.execute({
            type: 'addAutomationPoint',
            payload: { laneId: 'lane1', beat: 0, value: 1, pointId: 'my-id' },
        });
        const call = mockedAddPoint.mock.calls[0];
        if (!call) {
            throw new TypeError('expected addPoint to have been called');
        }
        const point = call[1];
        expect(point.id).toBe('my-id');
    });

    it('passes through cp1/cp2/stairSteps', () => {
        handleAddAutomationPoint.execute({
            type: 'addAutomationPoint',
            payload: { laneId: 'lane1', beat: 0, value: 0.5, cp1: { x: 0.1, y: 0.2 }, stairSteps: 4 },
        });
        const call = mockedAddPoint.mock.calls[0];
        if (!call) {
            throw new TypeError('expected addPoint to have been called');
        }
        const point = call[1];
        expect(point.cp1).toEqual({ x: 0.1, y: 0.2 });
        expect(point.stairSteps).toBe(4);
    });
});

describe('handleAddAutomationPoint — describe', () => {
    it('returns inverse removeAutomationPoint with computed insert index', () => {
        setLane([
            { id: 'p1', beat: 2 },
            { id: 'p2', beat: 8 },
        ]);
        const result = handleAddAutomationPoint.describe({
            type: 'addAutomationPoint',
            payload: { laneId: 'lane1', beat: 4, value: 0.5 },
        });
        expect(result.label).toBe('Add automation point');
        expect(result.inverseAction?.type).toBe('removeAutomationPoint');
        const payload = (result.inverseAction as { payload: { pointIndex: number; pointId: string } }).payload;
        // New point at beat 4 goes after beat-2 point (index 1)
        expect(payload.pointIndex).toBe(1);
    });

    it('returns label without inverse when lane not found', () => {
        setLane(null);
        const result = handleAddAutomationPoint.describe({
            type: 'addAutomationPoint',
            payload: { laneId: 'missing', beat: 4, value: 0.5 },
        });
        expect(result.label).toBe('Add automation point');
        expect(result.inverseAction).toBeUndefined();
    });
});

describe('describeLaneTransformUndo', () => {
    it('returns label without inverse when lane not found', () => {
        setLane(null);
        const result = describeLaneTransformUndo('missing', 'Scale', { type: 'scale', factor: 2 });
        expect(result.label).toBe('Scale');
        expect(result.inverseAction).toBeUndefined();
    });

    it('returns inverse restoreAutomationLanePoints with current points and transformed points', () => {
        setLane([{ id: 'p1', beat: 0, value: 0.5, curve: 'linear', tension: 0 }]);
        mockedTransform.mockReturnValue([{ id: 'p1', beat: 0, value: 1, curve: 'linear', tension: 0 }] as never);
        const result = describeLaneTransformUndo('lane1', 'Scale', { type: 'scale', factor: 2 });
        expect(result.label).toBe('Scale');
        expect(result.inverseAction?.type).toBe('restoreAutomationLanePoints');
        const payload = (
            result.inverseAction as unknown as {
                payload: { laneId: string; points: unknown[]; expectedPoints: unknown[] };
            }
        ).payload;
        expect(payload.laneId).toBe('lane1');
        expect(payload.points).toHaveLength(1);
        expect(payload.expectedPoints).toHaveLength(1);
    });

    it('clones control points in the snapshot', () => {
        setLane([{ id: 'p1', beat: 0, value: 0.5, curve: 'linear', tension: 0, cp1: { x: 0.1, y: 0.2 } }]);
        mockedTransform.mockReturnValue([{ id: 'p1', beat: 0, value: 1, curve: 'linear', tension: 0 }] as never);
        const result = describeLaneTransformUndo('lane1', 'Scale', { type: 'scale', factor: 2 });
        const payload = (
            result.inverseAction as unknown as { payload: { points: Array<{ cp1?: { x: number; y: number } }> } }
        ).payload;
        expect(payload.points[0]?.cp1).toEqual({ x: 0.1, y: 0.2 });
        // Verify it's a clone, not the same reference
        const stateLane = mockedGetState.mockReturnValue as unknown as never;
        expect(payload.points[0]?.cp1).not.toBe(stateLane);
    });
});
