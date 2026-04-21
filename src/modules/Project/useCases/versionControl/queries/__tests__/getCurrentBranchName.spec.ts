import { describe, it, expect } from 'vitest';

import * as subject from '../getCurrentBranchName';

describe('getCurrentBranchName', () => {
    it('should export getCurrentBranchName', () => {
        expect(subject.getCurrentBranchName).toBeDefined();
        const time = typeof subject.getCurrentBranchName;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
