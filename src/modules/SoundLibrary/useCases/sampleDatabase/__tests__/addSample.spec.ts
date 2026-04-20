import { describe, it, expect } from 'vitest';

import * as subject from '../addSample';

describe('addSample', () => {
    it('should export addSample', () => {
        expect(subject.addSample).toBeDefined();
        const t = typeof subject.addSample;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
