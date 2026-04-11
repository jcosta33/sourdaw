import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLayerCount } from '../getLayerCount';

const mockSet = vi.fn();
let mockValue: any = null;

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() { return mockValue; },
        set: (v: any) => mockSet(v)
    }
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
