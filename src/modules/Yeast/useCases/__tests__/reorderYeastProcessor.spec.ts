import { describe, it, expect } from 'vitest';

import * as subject from '../reorderYeastProcessor';

describe('reorderYeastProcessor', () => {
    it('should export reorderYeastProcessor', () => {
        expect(subject.reorderYeastProcessor).toBeDefined();
        const time = typeof subject.reorderYeastProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
