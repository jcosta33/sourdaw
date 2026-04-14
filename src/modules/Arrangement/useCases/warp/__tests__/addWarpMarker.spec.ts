import { describe, it, expect } from 'vitest';
import * as subject from '../addWarpMarker';

describe('addWarpMarker', () => {
    it('should export addWarpMarker', () => {
        expect(subject.addWarpMarker).toBeDefined();
        const t = typeof subject.addWarpMarker;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
