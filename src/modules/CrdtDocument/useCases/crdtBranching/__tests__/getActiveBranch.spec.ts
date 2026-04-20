import { describe, it, expect } from 'vitest';

import * as subject from '../getActiveBranch';

describe('getActiveBranch', () => {
    it('should export getActiveBranch', () => {
        expect(subject.getActiveBranch).toBeDefined();
        const t = typeof subject.getActiveBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
