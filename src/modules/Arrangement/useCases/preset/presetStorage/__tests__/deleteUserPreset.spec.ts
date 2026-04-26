import { describe, it, expect } from 'vitest';

import * as subject from '../deleteUserPreset';

describe('deleteUserPreset', () => {
    it('should export deleteUserPreset', () => {
        expect(subject.deleteUserPreset).toBeDefined();
        const time = typeof subject.deleteUserPreset;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
