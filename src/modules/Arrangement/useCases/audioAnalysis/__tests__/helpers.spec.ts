import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getBufferForClip', () => {
        expect(subject.getBufferForClip).toBeDefined();
        const time = typeof subject.getBufferForClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
