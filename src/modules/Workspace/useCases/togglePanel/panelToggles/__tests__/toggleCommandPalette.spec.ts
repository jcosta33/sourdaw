import { describe, it, expect } from 'vitest';
import * as subject from '../toggleCommandPalette';

describe('toggleCommandPalette', () => {
    it('should export toggleCommandPalette', () => {
        expect(subject.toggleCommandPalette).toBeDefined();
        const t = typeof subject.toggleCommandPalette;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
