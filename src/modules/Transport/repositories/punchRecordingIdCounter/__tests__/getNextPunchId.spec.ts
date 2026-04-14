import { describe, it, expect } from 'vitest';
import { getNextPunchId } from '../getNextPunchId';

describe('getNextPunchId', () => {
    it('should return a punch ID and increment it', () => {
        const id1 = getNextPunchId();
        const id2 = getNextPunchId();
        expect(id1.startsWith('punch-')).toBe(true);
        expect(id1).not.toBe(id2);

        const n1 = parseInt(id1.split('-')[1]!, 10);
        const n2 = parseInt(id2.split('-')[1]!, 10);
        expect(n2).toBe(n1 + 1);
    });
});
