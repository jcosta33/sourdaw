import { describe, it, expect } from 'vitest';

import * as subject from '../setCrumbsParamImmediate';

describe('setCrumbsParamImmediate', () => {
    it('should export setCrumbsParamImmediate', () => {
        expect(subject.setCrumbsParamImmediate).toBeDefined();
        const t = typeof subject.setCrumbsParamImmediate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
