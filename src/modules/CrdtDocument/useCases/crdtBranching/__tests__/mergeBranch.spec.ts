import { describe, it, expect } from 'vitest';

import * as subject from '../mergeBranch';

describe('mergeBranch', () => {
    it('should export mergeBranch', () => {
        expect(subject.mergeBranch).toBeDefined();
        const time = typeof subject.mergeBranch;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
