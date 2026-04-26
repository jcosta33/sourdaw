import { describe, it, expect } from 'vitest';

import * as subject from '../listBranches';

describe('listBranches', () => {
    it('should export listBranches', () => {
        expect(subject.listBranches).toBeDefined();
        const time = typeof subject.listBranches;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
