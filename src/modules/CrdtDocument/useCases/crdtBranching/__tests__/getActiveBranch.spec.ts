import { describe, it, expect } from 'vitest';

import * as subject from '../getActiveBranch';

describe('getActiveBranch', () => {
    it('should export getActiveBranch', () => {
        expect(subject.getActiveBranch).toBeDefined();
        const time = typeof subject.getActiveBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
