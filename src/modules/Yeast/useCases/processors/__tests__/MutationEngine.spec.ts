import { describe, it, expect } from 'vitest';
import * as subject from '../MutationEngine';

describe('MutationEngine', () => {
    it('should export MutationEngine', () => {
        expect(subject.MutationEngine).toBeDefined();
        const t = typeof subject.MutationEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
