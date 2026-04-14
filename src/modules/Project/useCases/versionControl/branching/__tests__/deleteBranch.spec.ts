import { describe, it, expect } from 'vitest';
import * as subject from '../deleteBranch';

describe('deleteBranch', () => {
    it('should export deleteBranch', () => {
        expect(subject.deleteBranch).toBeDefined();
        const t = typeof subject.deleteBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
