import { describe, it, expect } from 'vitest';

import * as subject from '../forkProjectBranch';

describe('forkProjectBranch', () => {
    it('should export forkProjectBranch', () => {
        expect(subject.forkProjectBranch).toBeDefined();
        const t = typeof subject.forkProjectBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
