import { describe, it, expect } from 'vitest';

import * as subject from '../tagVersion';

describe('tagVersion', () => {
    it('should export tagVersion', () => {
        expect(subject.tagVersion).toBeDefined();
        const t = typeof subject.tagVersion;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
