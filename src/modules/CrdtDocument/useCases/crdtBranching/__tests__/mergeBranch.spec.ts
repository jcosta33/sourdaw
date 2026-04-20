import { describe, it, expect } from 'vitest';

import * as subject from '../mergeBranch';

describe('mergeBranch', () => {
    it('should export mergeBranch', () => {
        expect(subject.mergeBranch).toBeDefined();
        const t = typeof subject.mergeBranch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
