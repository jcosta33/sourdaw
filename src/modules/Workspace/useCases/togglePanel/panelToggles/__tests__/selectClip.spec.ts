import { describe, it, expect } from 'vitest';

import * as subject from '../selectClip';

describe('selectClip', () => {
    it('should export selectClip', () => {
        expect(subject.selectClip).toBeDefined();
        const t = typeof subject.selectClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
