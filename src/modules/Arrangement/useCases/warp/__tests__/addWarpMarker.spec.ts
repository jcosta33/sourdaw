import { describe, it, expect } from 'vitest';

import * as subject from '../addWarpMarker';

describe('addWarpMarker', () => {
    it('should export addWarpMarker', () => {
        expect(subject.addWarpMarker).toBeDefined();
        const time = typeof subject.addWarpMarker;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
