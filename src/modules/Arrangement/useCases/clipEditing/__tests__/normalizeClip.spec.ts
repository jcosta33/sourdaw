import { describe, it, expect } from 'vitest';

import * as subject from '../normalizeClip';

describe('normalizeClip', () => {
    it('should export normalizeClip', () => {
        expect(subject.normalizeClip).toBeDefined();
        const time = typeof subject.normalizeClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
