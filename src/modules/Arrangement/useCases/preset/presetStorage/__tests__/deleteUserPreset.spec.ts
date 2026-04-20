import { describe, it, expect } from 'vitest';

import * as subject from '../deleteUserPreset';

describe('deleteUserPreset', () => {
    it('should export deleteUserPreset', () => {
        expect(subject.deleteUserPreset).toBeDefined();
        const t = typeof subject.deleteUserPreset;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
