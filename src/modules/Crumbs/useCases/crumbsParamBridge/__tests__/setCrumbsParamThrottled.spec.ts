import { describe, it, expect } from 'vitest';

import * as subject from '../setCrumbsParamThrottled';

describe('setCrumbsParamThrottled', () => {
    it('should export setCrumbsParamThrottled', () => {
        expect(subject.setCrumbsParamThrottled).toBeDefined();
        const t = typeof subject.setCrumbsParamThrottled;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
