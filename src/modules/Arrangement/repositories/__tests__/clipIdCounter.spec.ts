import { describe, it, expect } from 'vitest';
import { getNextClipId } from '../clipIdCounter';

describe('clipIdCounter', () => {
    it('returns sequential clip IDs', () => {
        const id1 = getNextClipId();
        const id2 = getNextClipId();
        const id3 = getNextClipId();

        expect(id1).toMatch(/^clip-\d+$/);
        expect(id2).toMatch(/^clip-\d+$/);
        
        const num1 = parseInt(id1.split('-')[1]);
        const num2 = parseInt(id2.split('-')[1]);
        const num3 = parseInt(id3.split('-')[1]);

        expect(num2).toBe(num1 + 1);
        expect(num3).toBe(num2 + 1);
    });
});
