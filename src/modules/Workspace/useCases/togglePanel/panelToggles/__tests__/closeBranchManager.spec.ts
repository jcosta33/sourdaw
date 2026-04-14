import { describe, it, expect } from 'vitest';
import * as subject from '../closeBranchManager';

describe('closeBranchManager', () => {
    it('should export closeBranchManager', () => {
        expect(subject.closeBranchManager).toBeDefined();
        const t = typeof subject.closeBranchManager;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
