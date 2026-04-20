import { describe, it, expect } from 'vitest';

import * as subject from '../getSampleCount';

describe('getSampleCount', () => {
    it('should export getSampleCount', () => {
        expect(subject.getSampleCount).toBeDefined();
        const t = typeof subject.getSampleCount;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
