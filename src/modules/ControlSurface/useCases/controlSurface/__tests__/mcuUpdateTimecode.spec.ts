import { describe, it, expect } from 'vitest';

import * as subject from '../mcuUpdateTimecode';

describe('mcuUpdateTimecode', () => {
    it('should export mcuUpdateTimecode', () => {
        expect(subject.mcuUpdateTimecode).toBeDefined();
        const time = typeof subject.mcuUpdateTimecode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
