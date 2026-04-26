import { describe, it, expect } from 'vitest';

import * as subject from '../MutationEngine';

describe('MutationEngine', () => {
    it('should export MutationEngine', () => {
        expect(subject.MutationEngine).toBeDefined();
        const time = typeof subject.MutationEngine;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
