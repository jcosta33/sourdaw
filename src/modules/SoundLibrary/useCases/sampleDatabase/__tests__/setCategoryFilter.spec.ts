import { describe, it, expect } from 'vitest';

import * as subject from '../setCategoryFilter';

describe('setCategoryFilter', () => {
    it('should export setCategoryFilter', () => {
        expect(subject.setCategoryFilter).toBeDefined();
        const t = typeof subject.setCategoryFilter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
