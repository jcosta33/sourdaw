import { describe, it, expect } from 'vitest';
import * as subject from '../removeWarpMarker';

describe('removeWarpMarker', () => {
    it('should export removeWarpMarker', () => {
        expect(subject.removeWarpMarker).toBeDefined();
        const t = typeof subject.removeWarpMarker;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
