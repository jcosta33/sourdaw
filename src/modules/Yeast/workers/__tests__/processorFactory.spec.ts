import { describe, it, expect } from 'vitest';

import * as subject from '../processorFactory';

describe('processorFactory', () => {
    it('should export createProcessor', () => {
        expect(subject.createProcessor).toBeDefined();
        const time = typeof subject.createProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
