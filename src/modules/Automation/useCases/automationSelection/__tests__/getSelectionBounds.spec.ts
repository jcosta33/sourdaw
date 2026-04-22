import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationPoint, createAutomationLane } from '#/modules/Automation/models/Automation';

import { getSelectionBounds } from '../getSelectionBounds';

const mocks = vi.hoisted(() => ({
    automationStoreValue: { value: { lanes: [] as import('#/modules/Automation/models/Automation').AutomationLane[] } },
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
    },
}));

describe('getSelectionBounds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calculates bounding box of selected points', () => {
        const points: AutomationPoint[] = [
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 0.8, curve: 'linear', tension: 0 }, // Selected
            { beat: 8, value: 0.2, curve: 'linear', tension: 0 }, // Selected
            { beat: 12, value: 1.0, curve: 'linear', tension: 0 },
        ];
        mocks.automationStoreValue.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points }],
        };

        const bounds = getSelectionBounds('l1', [4, 8]);

        expect(bounds).toEqual({
            minBeat: 4,
            maxBeat: 8,
            minValue: 0.2,
            maxValue: 0.8,
        });
    });

    it('returns null if lane not found', () => {
        mocks.automationStoreValue.value = { lanes: [] };
        expect(getSelectionBounds('l1', [0])).toBeNull();
    });

    it('returns null if no points found at selected beats', () => {
        const points: AutomationPoint[] = [{ beat: 10, value: 1, curve: 'linear', tension: 0 }];
        mocks.automationStoreValue.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points }],
        };
        expect(getSelectionBounds('l1', [0])).toBeNull();
    });
});
