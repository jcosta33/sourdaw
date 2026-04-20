import { describe, it, expect } from 'vitest';

import * as subject from '../createVersionBranch';

describe('createVersionBranch', () => {
    it('should export createVersionBranch', () => {
        expect(subject.createVersionBranch).toBeDefined();
        const t = typeof subject.createVersionBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
