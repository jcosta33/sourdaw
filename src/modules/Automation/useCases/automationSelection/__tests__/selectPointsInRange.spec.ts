import { describe, it, expect } from 'vitest';

import * as subject from '../selectPointsInRange';

describe('selectPointsInRange', () => {
    it('should export selectPointsInRange', () => {
        expect(subject.selectPointsInRange).toBeDefined();
        const time = typeof subject.selectPointsInRange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
