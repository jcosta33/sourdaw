import { describe, it, expect } from 'vitest';
import * as subject from '../duplicateTrack';

describe('duplicateTrack', () => {
    it('should export duplicateTrack', () => {
        expect(subject.duplicateTrack).toBeDefined();
        const t = typeof subject.duplicateTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
