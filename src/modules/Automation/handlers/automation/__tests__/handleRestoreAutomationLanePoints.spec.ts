import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));

vi.mock('../../../useCases/automation/restoreAutomationLanePoints', () => ({
    restoreAutomationLanePoints: vi.fn(),
}));

import { restoreAutomationLanePoints } from '../../../useCases/automation/restoreAutomationLanePoints';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { handleRestoreAutomationLanePoints } from '../handleRestoreAutomationLanePoints';

const mockedGetState = vi.mocked(getAutomationStoreState);
const mockedRestore = vi.mocked(restoreAutomationLanePoints);

function makePoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'p1',
        beat: 0,
        value: 0.5,
        curve: 'linear',
        tension: 0,
        ...overrides,
    };
}

function setLane(points: Record<string, unknown>[] | null): void {
    if (points === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({
            lanes: [{ id: 'lane1', points }],
        } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRestoreAutomationLanePoints — execute', () => {
    it('writes replacement when expectedPoints match current', () => {
        const points = [makePoint()];
        setLane(points);
        const result = handleRestoreAutomationLanePoints.execute({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane1', points: points as never, expectedPoints: points as never },
        });
        expect(result).toEqual({ status: 'written' });
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('returns conflict when expectedPoints do not match current', () => {
        setLane([makePoint({ value: 0.9 })]);
        const expected = [makePoint({ value: 0.5 })];
        const result = handleRestoreAutomationLanePoints.execute({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane1', points: expected as never, expectedPoints: expected as never },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('returns conflict when store is null and expectedPoints provided', () => {
        setLane(null);
        const result = handleRestoreAutomationLanePoints.execute({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane1', points: [] as never, expectedPoints: [] as never },
        });
        expect(result).toEqual({ status: 'conflict' });
    });

    it('returns no-write when lane not found and no expectedPoints', () => {
        setLane([{ id: 'otherLane', points: [] }]);
        const result = handleRestoreAutomationLanePoints.execute({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'missing', points: [] as never },
        });
        expect(result).toEqual({ status: 'no-write' });
    });

    it('writes when no expectedPoints provided and lane exists', () => {
        setLane([makePoint()]);
        const result = handleRestoreAutomationLanePoints.execute({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane1', points: [makePoint({ value: 1 })] as never },
        });
        expect(result).toEqual({ status: 'written' });
    });
});

describe('handleRestoreAutomationLanePoints — isNoop', () => {
    it('returns true when store is null and no expectedPoints', () => {
        setLane(null);
        expect(
            handleRestoreAutomationLanePoints.isNoop!({
                type: 'restoreAutomationLanePoints',
                payload: { laneId: 'lane1', points: [] as never },
            })
        ).toBe(true);
    });

    it('returns false when expectedPoints mismatch', () => {
        setLane([makePoint({ value: 0.9 })]);
        expect(
            handleRestoreAutomationLanePoints.isNoop!({
                type: 'restoreAutomationLanePoints',
                payload: { laneId: 'lane1', points: [] as never, expectedPoints: [makePoint()] as never },
            })
        ).toBe(false);
    });

    it('returns true when points already match', () => {
        const points = [makePoint()];
        setLane(points);
        expect(
            handleRestoreAutomationLanePoints.isNoop!({
                type: 'restoreAutomationLanePoints',
                payload: { laneId: 'lane1', points: points as never },
            })
        ).toBe(true);
    });

    it('returns false when points differ', () => {
        setLane([makePoint({ value: 0.5 })]);
        expect(
            handleRestoreAutomationLanePoints.isNoop!({
                type: 'restoreAutomationLanePoints',
                payload: { laneId: 'lane1', points: [makePoint({ value: 0.9 })] as never },
            })
        ).toBe(false);
    });
});

describe('handleRestoreAutomationLanePoints — describe', () => {
    it('returns label without inverse action', () => {
        const result = handleRestoreAutomationLanePoints.describe({
            type: 'restoreAutomationLanePoints',
            payload: { laneId: 'lane1', points: [] as never },
        });
        expect(result.label).toBe('Restore automation points');
        expect(result.inverseAction).toBeUndefined();
    });
});
