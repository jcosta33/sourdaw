import { describe, it, expect } from 'vitest';

import * as subject from '../rateSample';

describe('rateSample', () => {
    it('should export rateSample', () => {
        expect(subject.rateSample).toBeDefined();
        const t = typeof subject.rateSample;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
