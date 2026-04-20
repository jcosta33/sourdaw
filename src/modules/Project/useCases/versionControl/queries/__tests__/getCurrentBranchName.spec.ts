import { describe, it, expect } from 'vitest';

import * as subject from '../getCurrentBranchName';

describe('getCurrentBranchName', () => {
    it('should export getCurrentBranchName', () => {
        expect(subject.getCurrentBranchName).toBeDefined();
        const t = typeof subject.getCurrentBranchName;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
