import { describe, it, expect } from 'vitest';

import * as subject from '../toggleBranchManager';

describe('toggleBranchManager', () => {
    it('should export toggleBranchManager', () => {
        expect(subject.toggleBranchManager).toBeDefined();
        const time = typeof subject.toggleBranchManager;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
