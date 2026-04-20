import { describe, it, expect } from 'vitest';

import * as subject from '../moveWarpMarker';

describe('moveWarpMarker', () => {
    it('should export moveWarpMarker', () => {
        expect(subject.moveWarpMarker).toBeDefined();
        const t = typeof subject.moveWarpMarker;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
