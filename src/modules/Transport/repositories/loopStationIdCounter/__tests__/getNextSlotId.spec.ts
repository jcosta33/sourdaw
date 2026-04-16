import { describe, it, expect } from 'vitest';
import { getNextSlotId } from '../getNextSlotId';

describe('getNextSlotId', () => {
    it('should return a unique slot ID', () => {
        const id1 = getNextSlotId();
        const id2 = getNextSlotId();
        expect(id1.startsWith('loop-')).toBe(true);
        expect(id2.startsWith('loop-')).toBe(true);
        expect(id1).not.toBe(id2);
    });
});
