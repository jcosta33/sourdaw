import { describe, it, expect } from 'vitest';
import * as subject from '../toggleBranchManager';

describe('toggleBranchManager', () => {
    it('should export toggleBranchManager', () => {
        expect(subject.toggleBranchManager).toBeDefined();
        const t = typeof subject.toggleBranchManager;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
