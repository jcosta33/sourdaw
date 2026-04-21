import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export readStoredPresets', () => {
        expect(subject.readStoredPresets).toBeDefined();
        const time = typeof subject.readStoredPresets;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export writeStoredPresets', () => {
        expect(subject.writeStoredPresets).toBeDefined();
        const time = typeof subject.writeStoredPresets;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
