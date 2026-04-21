import { describe, it, expect } from 'vitest';

import * as subject from '../moveWarpMarker';

describe('moveWarpMarker', () => {
    it('should export moveWarpMarker', () => {
        expect(subject.moveWarpMarker).toBeDefined();
        const time = typeof subject.moveWarpMarker;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
