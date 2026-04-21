import { describe, it, expect } from 'vitest';

import * as subject from '../mcuSetFader';

describe('mcuSetFader', () => {
    it('should export mcuSetFader', () => {
        expect(subject.mcuSetFader).toBeDefined();
        const time = typeof subject.mcuSetFader;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
