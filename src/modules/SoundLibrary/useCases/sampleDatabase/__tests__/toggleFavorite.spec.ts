import { describe, it, expect } from 'vitest';
import * as subject from '../toggleFavorite';

describe('toggleFavorite', () => {
    it('should export toggleFavorite', () => {
        expect(subject.toggleFavorite).toBeDefined();
        const t = typeof subject.toggleFavorite;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
