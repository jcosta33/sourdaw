import { describe, it, expect } from 'vitest';

import * as subject from '../ScaleQuantizer';

describe('ScaleQuantizer', () => {
    it('should export ScaleQuantizer', () => {
        expect(subject.ScaleQuantizer).toBeDefined();
        const time = typeof subject.ScaleQuantizer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
