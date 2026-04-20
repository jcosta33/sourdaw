import { describe, it, expect } from 'vitest';

import * as subject from '../createBufferSource';

describe('createBufferSource', () => {
    it('should export createBufferSource', () => {
        expect(subject.createBufferSource).toBeDefined();
        const t = typeof subject.createBufferSource;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
