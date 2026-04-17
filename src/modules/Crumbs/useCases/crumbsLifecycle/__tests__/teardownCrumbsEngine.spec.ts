import { describe, it, expect } from 'vitest';
import * as subject from '../teardownCrumbsEngine';

describe('teardownCrumbsEngine', () => {
    it('should export teardownCrumbsEngine', () => {
        expect(subject.teardownCrumbsEngine).toBeDefined();
        const t = typeof subject.teardownCrumbsEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
