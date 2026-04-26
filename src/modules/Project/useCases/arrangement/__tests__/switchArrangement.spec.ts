import { describe, it, expect } from 'vitest';

import * as subject from '../switchArrangement';

describe('switchArrangement', () => {
    it('should export switchArrangement', () => {
        expect(subject.switchArrangement).toBeDefined();
        const time = typeof subject.switchArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
