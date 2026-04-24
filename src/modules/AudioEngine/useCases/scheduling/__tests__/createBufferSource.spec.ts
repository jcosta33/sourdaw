import { describe, it, expect } from 'vitest';

import * as subject from '../createBufferSource';

describe('createBufferSource', () => {
    it('should export createBufferSource', () => {
        expect(subject.createBufferSource).toBeDefined();
        const time = typeof subject.createBufferSource;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
