import { describe, it, expect } from 'vitest';

import * as subject from '../getBranchCount';

describe('getBranchCount', () => {
    it('should export getBranchCount', () => {
        expect(subject.getBranchCount).toBeDefined();
        const t = typeof subject.getBranchCount;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
