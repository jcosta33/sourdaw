import { describe, it, expect } from 'vitest';

import * as subject from '../clearSolos';

describe('clearSolos', () => {
    it('should export clearSolos', () => {
        expect(subject.clearSolos).toBeDefined();
        const time = typeof subject.clearSolos;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
