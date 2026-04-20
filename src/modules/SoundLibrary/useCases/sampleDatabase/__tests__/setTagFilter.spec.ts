import { describe, it, expect } from 'vitest';

import * as subject from '../setTagFilter';

describe('setTagFilter', () => {
    it('should export setTagFilter', () => {
        expect(subject.setTagFilter).toBeDefined();
        const t = typeof subject.setTagFilter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
