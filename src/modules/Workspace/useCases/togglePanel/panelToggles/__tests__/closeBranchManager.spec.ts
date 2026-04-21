import { describe, it, expect } from 'vitest';

import * as subject from '../closeBranchManager';

describe('closeBranchManager', () => {
    it('should export closeBranchManager', () => {
        expect(subject.closeBranchManager).toBeDefined();
        const time = typeof subject.closeBranchManager;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
