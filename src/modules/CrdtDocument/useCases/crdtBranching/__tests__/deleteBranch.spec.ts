import { describe, it, expect } from 'vitest';

import * as subject from '../deleteBranch';

describe('deleteBranch', () => {
    it('should export deleteBranch', () => {
        expect(subject.deleteBranch).toBeDefined();
        const time = typeof subject.deleteBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
