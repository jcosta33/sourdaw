import { describe, it, expect } from 'vitest';

import * as subject from '../removeWarpMarker';

describe('removeWarpMarker', () => {
    it('should export removeWarpMarker', () => {
        expect(subject.removeWarpMarker).toBeDefined();
        const time = typeof subject.removeWarpMarker;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
