import { describe, it, expect } from 'vitest';

import * as subject from '../createArrangement';

describe('createArrangement', () => {
    it('should export createArrangement', () => {
        expect(subject.createArrangement).toBeDefined();
        const time = typeof subject.createArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
