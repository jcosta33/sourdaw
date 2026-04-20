import { describe, it, expect } from 'vitest';

import * as subject from '../switchBranch';

describe('switchBranch', () => {
    it('should export switchBranch', () => {
        expect(subject.switchBranch).toBeDefined();
        const t = typeof subject.switchBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
