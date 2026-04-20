import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getSelectionBounds } from '../getSelectionBounds';

const mocks = vi.hoisted(() => ({
    automationStoreValue: { value: { lanes: [] } },
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
        const points = [
            { beat: 0, value: 0 },
            { beat: 4, value: 0.8 }, // Selected
            { beat: 8, value: 0.2 }, // Selected
            { beat: 12, value: 1.0 },
        ];
        mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

        const bounds = getSelectionBounds('l1', [4, 8]);

        expect(bounds).toEqual({
            minBeat: 4,
            maxBeat: 8,
            minValue: 0.2,
            maxValue: 0.8,
        });
    });

    it('returns null if lane not found', () => {
        mocks.automationStoreValue.value = { lanes: [] } as any;
        expect(getSelectionBounds('l1', [0])).toBeNull();
    });

    it('returns null if no points found at selected beats', () => {
        mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points: [{ beat: 10, value: 1 }] }] } as any;
        expect(getSelectionBounds('l1', [0])).toBeNull();
    });
});
