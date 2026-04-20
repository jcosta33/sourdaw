import { describe, it, expect } from 'vitest';

import * as subject from '../toggleFavoritesOnly';

describe('toggleFavoritesOnly', () => {
    it('should export toggleFavoritesOnly', () => {
        expect(subject.toggleFavoritesOnly).toBeDefined();
        const t = typeof subject.toggleFavoritesOnly;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
