import { describe, it, expect } from 'vitest';
import { getNextPunchId } from '../getNextPunchId';

describe('getNextPunchId', () => {
    it('should return a unique punch ID', () => {
        const id1 = getNextPunchId();
        const id2 = getNextPunchId();
        expect(id1.startsWith('punch-')).toBe(true);
        expect(id2.startsWith('punch-')).toBe(true);
        expect(id1).not.toBe(id2);
    });
});
