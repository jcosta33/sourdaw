import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));

vi.mock('../../../useCases/automation/removeAutomationPoint', () => ({
    removeAutomationPoint: vi.fn(),
}));

vi.mock('../../../useCases/automation/removeAutomationPointById', () => ({
    removeAutomationPointById: vi.fn(),
}));

import { removeAutomationPoint } from '../../../useCases/automation/removeAutomationPoint';
import { removeAutomationPointById } from '../../../useCases/automation/removeAutomationPointById';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { handleRemoveAutomationPoint } from '../handleRemoveAutomationPoint';

const mockedGetState = vi.mocked(getAutomationStoreState);
const mockedRemove = vi.mocked(removeAutomationPoint);
const mockedRemoveById = vi.mocked(removeAutomationPointById);

function makePoint(overrides: Record<string, unknown> = {}) {
    return { id: 'p1', beat: 4, value: 0.5, curve: 'linear', tension: 0, ...overrides };
}

function setLane(points: Record<string, unknown>[] | null) {
    if (points === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ lanes: [{ id: 'lane1', points }] } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRemoveAutomationPoint — execute', () => {
    it('calls removeAutomationPoint with laneId and beat when using index', () => {
        setLane([makePoint()]);
        handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0 },
        });
        expect(mockedRemove).toHaveBeenCalledWith('lane1', 4);
    });

    it('calls removeAutomationPointById when pointId provided', () => {
        setLane([makePoint({ id: 'target' })]);
        handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0, pointId: 'target' },
        });
        expect(mockedRemoveById).toHaveBeenCalledWith('lane1', 'target');
        expect(mockedRemove).not.toHaveBeenCalled();
    });

    it('does nothing when point not found', () => {
        setLane([]);
        handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0 },
        });
        expect(mockedRemove).not.toHaveBeenCalled();
        expect(mockedRemoveById).not.toHaveBeenCalled();
    });

    it('does nothing when lane not found', () => {
        mockedGetState.mockReturnValue({ lanes: [] });
        handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'missing', pointIndex: 0 },
        });
        expect(mockedRemove).not.toHaveBeenCalled();
    });
});

describe('handleRemoveAutomationPoint — describe', () => {
    it('returns inverse addAutomationPoint when point found and beat is unique', () => {
        setLane([makePoint({ id: 'p1', beat: 4 })]);
        const result = handleRemoveAutomationPoint.describe({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0 },
        });
        expect(result.label).toBe('Remove automation point');
        expect(result.inverseAction?.type).toBe('addAutomationPoint');
        const payload = (result.inverseAction as { payload: { beat: number; laneId: string } }).payload;
        expect(payload.beat).toBe(4);
        expect(payload.laneId).toBe('lane1');
    });

    it('omits inverse when beat is duplicated (no pointId)', () => {
        setLane([makePoint({ id: 'p1', beat: 4 }), makePoint({ id: 'p2', beat: 4 })]);
        const result = handleRemoveAutomationPoint.describe({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0 },
        });
        expect(result.label).toBe('Remove automation point');
        expect(result.inverseAction).toBeUndefined();
    });

    it('returns inverse even with duplicated beat when pointId is used', () => {
        setLane([makePoint({ id: 'p1', beat: 4 }), makePoint({ id: 'p2', beat: 4 })]);
        const result = handleRemoveAutomationPoint.describe({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0, pointId: 'p1' },
        });
        expect(result.inverseAction?.type).toBe('addAutomationPoint');
    });

    it('omits inverse when point not found', () => {
        setLane([]);
        const result = handleRemoveAutomationPoint.describe({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane1', pointIndex: 0 },
        });
        expect(result.inverseAction).toBeUndefined();
    });
});
