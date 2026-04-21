import { describe, it, expect } from 'vitest';

import * as subject from '../forkProjectBranch';

describe('forkProjectBranch', () => {
    it('should export forkProjectBranch', () => {
        expect(subject.forkProjectBranch).toBeDefined();
        const time = typeof subject.forkProjectBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
