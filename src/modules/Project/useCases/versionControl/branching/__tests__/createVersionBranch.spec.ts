import { describe, it, expect } from 'vitest';

import * as subject from '../createVersionBranch';

describe('createVersionBranch', () => {
    it('should export createVersionBranch', () => {
        expect(subject.createVersionBranch).toBeDefined();
        const time = typeof subject.createVersionBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
