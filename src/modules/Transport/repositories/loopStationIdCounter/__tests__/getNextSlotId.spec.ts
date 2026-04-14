import { describe, it, expect } from 'vitest';
import { getNextSlotId } from '../getNextSlotId';

describe('getNextSlotId', () => {
    it('should return a slot ID and increment it', () => {
        const id1 = getNextSlotId();
        const id2 = getNextSlotId();
        expect(id1.startsWith('loop-')).toBe(true);
        expect(id1).not.toBe(id2);

        const n1 = parseInt(id1.split('-')[1]!, 10);
        const n2 = parseInt(id2.split('-')[1]!, 10);
        expect(n2).toBe(n1 + 1);
    });
});
