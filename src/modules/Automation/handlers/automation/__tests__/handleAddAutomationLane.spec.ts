import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));

vi.mock('../../../useCases/automation/addAutomationLane', () => ({
    addAutomationLane: vi.fn(),
}));

import { addAutomationLane } from '../../../useCases/automation/addAutomationLane';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { handleAddAutomationLane } from '../handleAddAutomationLane';

const mockedGetState = vi.mocked(getAutomationStoreState);
const mockedAddLane = vi.mocked(addAutomationLane);

function setState(lanes: Array<Record<string, unknown>> | null): void {
    if (lanes === null) {
        mockedGetState.mockReturnValue(null);
    } else {
        mockedGetState.mockReturnValue({ lanes } as never);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    setState(null);
});

describe('handleAddAutomationLane — execute', () => {
    it('calls addAutomationLane with trackId, parameterId, parameterName, and generated laneId', () => {
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'lane1' },
        };
        handleAddAutomationLane.execute(action);
        expect(mockedAddLane).toHaveBeenCalledWith('t1', 'gain', 'Gain', 'lane1');
    });

    it('generates a laneId when not provided', () => {
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain' },
        };
        handleAddAutomationLane.execute(action);
        expect(mockedAddLane).toHaveBeenCalledTimes(1);
        const laneId = mockedAddLane.mock.calls[0]?.[3];
        expect(laneId).toMatch(/^auto-/);
    });

    it('persists the generated laneId on the action payload', () => {
        const action = {
            type: 'addAutomationLane' as const,
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain' },
        } as {
            type: 'addAutomationLane';
            payload: { trackId: string; parameterId: string; parameterName: string; laneId?: string };
        };
        handleAddAutomationLane.execute(action);
        expect(action.payload.laneId).toMatch(/^auto-/);
    });
});

describe('handleAddAutomationLane — isNoop', () => {
    it('returns false when store is null', () => {
        setState(null);
        expect(
            handleAddAutomationLane.isNoop!({
                type: 'addAutomationLane',
                payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'l1' },
            })
        ).toBe(false);
    });

    it('returns false when no matching lane exists', () => {
        setState([{ id: 'other', trackId: 't1', parameterId: 'otherParam' }]);
        expect(
            handleAddAutomationLane.isNoop!({
                type: 'addAutomationLane',
                payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'l1' },
            })
        ).toBe(false);
    });

    it('returns true when lane with same id exists', () => {
        setState([{ id: 'l1', trackId: 't1', parameterId: 'other' }]);
        expect(
            handleAddAutomationLane.isNoop!({
                type: 'addAutomationLane',
                payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'l1' },
            })
        ).toBe(true);
    });

    it('returns true when lane with same trackId + parameterId exists (no clipId)', () => {
        setState([{ id: 'existing', trackId: 't1', parameterId: 'gain', clipId: undefined }]);
        expect(
            handleAddAutomationLane.isNoop!({
                type: 'addAutomationLane',
                payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'new' },
            })
        ).toBe(true);
    });
});

describe('handleAddAutomationLane — describe', () => {
    it('returns label with parameter name', () => {
        setState(null);
        const result = handleAddAutomationLane.describe({
            type: 'addAutomationLane',
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Volume', laneId: 'l1' },
        });
        expect(result.label).toBe('Add automation: Volume');
    });

    it('returns inverse removeAutomationLane when not a noop', () => {
        setState(null);
        const result = handleAddAutomationLane.describe({
            type: 'addAutomationLane',
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'l1' },
        });
        expect(result.inverseAction?.type).toBe('removeAutomationLane');
        expect((result.inverseAction as { payload: { laneId: string } }).payload.laneId).toBe('l1');
    });

    it('returns null inverse when noop (existing lane)', () => {
        setState([{ id: 'l1', trackId: 't1', parameterId: 'gain' }]);
        const result = handleAddAutomationLane.describe({
            type: 'addAutomationLane',
            payload: { trackId: 't1', parameterId: 'gain', parameterName: 'Gain', laneId: 'l1' },
        });
        expect(result.inverseAction).toBeUndefined();
    });
});
