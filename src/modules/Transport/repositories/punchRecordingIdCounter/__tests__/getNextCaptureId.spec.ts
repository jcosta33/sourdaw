import { describe, it, expect } from 'vitest';
import { getNextCaptureId } from '../getNextCaptureId';

describe('getNextCaptureId', () => {
    it('should return a capture ID and increment it', () => {
        const id1 = getNextCaptureId();
        const id2 = getNextCaptureId();
        expect(id1.startsWith('cap-')).toBe(true);
        expect(id1).not.toBe(id2);

        const n1 = parseInt(id1.split('-')[1]!, 10);
        const n2 = parseInt(id2.split('-')[1]!, 10);
        expect(n2).toBe(n1 + 1);
    });
});
