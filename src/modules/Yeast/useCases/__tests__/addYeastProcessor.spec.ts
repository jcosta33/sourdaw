import { describe, it, expect } from 'vitest';

import * as subject from '../addYeastProcessor';

describe('addYeastProcessor', () => {
    it('should export addYeastProcessor', () => {
        expect(subject.addYeastProcessor).toBeDefined();
        const time = typeof subject.addYeastProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
