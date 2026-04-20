import { describe, it, expect } from 'vitest';

import * as subject from '../saveCurrentAsPreset';

describe('saveCurrentAsPreset', () => {
    it('should export saveCurrentAsPreset', () => {
        expect(subject.saveCurrentAsPreset).toBeDefined();
        const t = typeof subject.saveCurrentAsPreset;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export saveUserPreset', () => {
        expect(subject.saveUserPreset).toBeDefined();
        const t = typeof subject.saveUserPreset;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
