import { describe, it, expect } from 'vitest';
import * as subject from '../listBranches';

describe('listBranches', () => {
    it('should export listBranches', () => {
        expect(subject.listBranches).toBeDefined();
        const t = typeof subject.listBranches;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
