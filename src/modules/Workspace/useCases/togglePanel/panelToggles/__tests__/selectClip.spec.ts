import { describe, it, expect } from 'vitest';

import * as subject from '../selectClip';

describe('selectClip', () => {
    it('should export selectClip', () => {
        expect(subject.selectClip).toBeDefined();
        const time = typeof subject.selectClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
