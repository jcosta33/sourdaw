import { describe, it, expect } from 'vitest';

import { getNextCaptureId } from '../getNextCaptureId';

describe('getNextCaptureId', () => {
    it('should return a unique capture ID', () => {
        const id1 = getNextCaptureId();
        const id2 = getNextCaptureId();
        expect(id1.startsWith('cap-')).toBe(true);
        expect(id2.startsWith('cap-')).toBe(true);
        expect(id1).not.toBe(id2);
    });
});
