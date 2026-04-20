import { describe, it, expect } from 'vitest';

import * as subject from '../selectPointsInRange';

describe('selectPointsInRange', () => {
    it('should export selectPointsInRange', () => {
        expect(subject.selectPointsInRange).toBeDefined();
        const t = typeof subject.selectPointsInRange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
