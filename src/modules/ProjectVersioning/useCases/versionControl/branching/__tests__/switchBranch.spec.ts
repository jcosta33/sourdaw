import { describe, it, expect } from 'vitest';

import * as subject from '../switchBranch';

describe('switchBranch', () => {
    it('should export switchBranch', () => {
        expect(subject.switchBranch).toBeDefined();
        const time = typeof subject.switchBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
