import { describe, it, expect } from 'vitest';
import { getNextLayerId } from '../getNextLayerId';

describe('getNextLayerId', () => {
    it('should return a unique layer ID', () => {
        const id1 = getNextLayerId();
        const id2 = getNextLayerId();
        expect(id1.startsWith('layer-')).toBe(true);
        expect(id2.startsWith('layer-')).toBe(true);
        expect(id1).not.toBe(id2);
    });
});
