import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getLayerCount } from '../getLayerCount';

const mockSet = vi.fn<(value: { layers: { id: string }[] } | null) => void>();
let mockValue: { layers: { id: string }[] } | null = null;

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mockValue;
        },
        set: (value: { layers: { id: string }[] } | null) => mockSet(value),
    },
}));

describe('getLayerCount', () => {
    beforeEach(() => {
        mockSet.mockReset();
    });

    it('returns layer count from the injected store', () => {
        mockValue = { layers: [{ id: 'l1' }, { id: 'l2' }] };
        expect(getLayerCount()).toBe(2);
    });

    it('returns 0 when store value is null', () => {
        mockValue = null;
        expect(getLayerCount()).toBe(0);
    });
});
