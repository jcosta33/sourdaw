import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutomationLane, type AutomationPoint } from '../../../models/Automation';

import type { AutomationStoreState } from '../../../stores/automationStore';

function point(value: number): AutomationPoint {
    return { beat: 0, value, curve: 'linear', tension: 0 };
}

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { zoomToUsedRange } = await import('../zoomToUsedRange');

describe('zoomToUsedRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fits the view to the used value range plus 10% padding', () => {
        mocks.state.value = {
            lanes: [
                {
                    ...createAutomationLane('t1', 'gain', 'Gain', 0, 10),
                    id: 'l1',
                    points: [point(2), point(8)],
                },
            ],
        };

        zoomToUsedRange('l1');

        const lane = mocks.state.value.lanes[0]!;
        expect(lane.viewMinValue).toBeCloseTo(1.4);
        expect(lane.viewMaxValue).toBeCloseTo(8.6);
    });

    it('clamps padding to the lane min/max bounds', () => {
        mocks.state.value = {
            lanes: [
                {
                    ...createAutomationLane('t1', 'gain', 'Gain', 0, 10),
                    id: 'l1',
                    points: [point(0.1), point(9.9)],
                },
            ],
        };

        zoomToUsedRange('l1');

        const lane = mocks.state.value.lanes[0]!;
        expect(lane.viewMinValue).toBe(0);
        expect(lane.viewMaxValue).toBe(10);
    });

    it('does nothing when the lane has no points', () => {
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points: [] }],
        };
        zoomToUsedRange('l1');
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;
        zoomToUsedRange('l1');
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
