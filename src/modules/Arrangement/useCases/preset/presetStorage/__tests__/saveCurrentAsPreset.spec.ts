import { describe, it, expect } from 'vitest';

import * as subject from '../saveCurrentAsPreset';

describe('saveCurrentAsPreset', () => {
    it('should export saveCurrentAsPreset', () => {
        expect(subject.saveCurrentAsPreset).toBeDefined();
        const time = typeof subject.saveCurrentAsPreset;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export saveUserPreset', () => {
        expect(subject.saveUserPreset).toBeDefined();
        const time = typeof subject.saveUserPreset;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
