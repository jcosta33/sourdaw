import { describe, it, expect } from 'vitest';

import * as subject from '../setSortBy';

describe('setSortBy', () => {
    it('should export setSortBy', () => {
        expect(subject.setSortBy).toBeDefined();
        const t = typeof subject.setSortBy;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
