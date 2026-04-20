import { describe, it, expect } from 'vitest';

import * as subject from '../initCrumbsEngine';

describe('initCrumbsEngine', () => {
    it('should export initCrumbsEngine', () => {
        expect(subject.initCrumbsEngine).toBeDefined();
        const t = typeof subject.initCrumbsEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
