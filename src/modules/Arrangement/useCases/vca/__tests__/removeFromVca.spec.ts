import { describe, it, expect } from 'vitest';

import * as subject from '../removeFromVca';

describe('removeFromVca', () => {
    it('should export removeFromVca', () => {
        expect(subject.removeFromVca).toBeDefined();
        const time = typeof subject.removeFromVca;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
