import { describe, it, expect } from 'vitest';

import * as subject from '../removeYeastProcessor';

describe('removeYeastProcessor', () => {
    it('should export removeYeastProcessor', () => {
        expect(subject.removeYeastProcessor).toBeDefined();
        const time = typeof subject.removeYeastProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
