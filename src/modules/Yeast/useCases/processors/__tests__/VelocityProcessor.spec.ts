import { describe, it, expect } from 'vitest';

import * as subject from '../VelocityProcessor';

describe('VelocityProcessor', () => {
    it('should export VelocityProcessor', () => {
        expect(subject.VelocityProcessor).toBeDefined();
        const time = typeof subject.VelocityProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
