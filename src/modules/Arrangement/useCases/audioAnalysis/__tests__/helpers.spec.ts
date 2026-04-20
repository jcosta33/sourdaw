import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getBufferForClip', () => {
        expect(subject.getBufferForClip).toBeDefined();
        const t = typeof subject.getBufferForClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
