import { describe, it, expect } from 'vitest';

import * as subject from '../toggleCommandPalette';

describe('toggleCommandPalette', () => {
    it('should export toggleCommandPalette', () => {
        expect(subject.toggleCommandPalette).toBeDefined();
        const time = typeof subject.toggleCommandPalette;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
