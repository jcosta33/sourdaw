import { describe, it, expect } from 'vitest';

import * as subject from '../closeCommandPalette';

describe('closeCommandPalette', () => {
    it('should export closeCommandPalette', () => {
        expect(subject.closeCommandPalette).toBeDefined();
        const t = typeof subject.closeCommandPalette;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
