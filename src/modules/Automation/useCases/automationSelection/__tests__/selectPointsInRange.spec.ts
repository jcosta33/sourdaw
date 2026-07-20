import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationLane, type AutomationPoint, createAutomationLane } from '../../../models/Automation';
import { selectPointsInRange } from '../selectPointsInRange';

const mocks = vi.hoisted(() => ({
    automationStoreValue: { value: { lanes: [] as AutomationLane[] } },
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
    },
}));

describe('selectPointsInRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns beats of points inside the rectangular region', () => {
        const points: AutomationPoint[] = [
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 0.5, curve: 'linear', tension: 0 },
            { beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            { beat: 12, value: 1, curve: 'linear', tension: 0 },
        ];
        mocks.automationStoreValue.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points }],
        };

        expect(selectPointsInRange('l1', 2, 10, 0.4, 0.95)).toEqual([4, 8]);
    });

    it('normalizes a reversed beat/value range', () => {
        const points: AutomationPoint[] = [{ beat: 4, value: 0.5, curve: 'linear', tension: 0 }];
        mocks.automationStoreValue.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points }],
        };

        expect(selectPointsInRange('l1', 10, 2, 0.95, 0.4)).toEqual([4]);
    });

    it('returns an empty array when the lane is not found', () => {
        mocks.automationStoreValue.value = { lanes: [] };
        expect(selectPointsInRange('l1', 0, 10, 0, 1)).toEqual([]);
    });
});
