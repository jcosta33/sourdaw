import { describe, it, expect } from 'vitest';

import * as subject from '../closeCommandPalette';

describe('closeCommandPalette', () => {
    it('should export closeCommandPalette', () => {
        expect(subject.closeCommandPalette).toBeDefined();
        const time = typeof subject.closeCommandPalette;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
