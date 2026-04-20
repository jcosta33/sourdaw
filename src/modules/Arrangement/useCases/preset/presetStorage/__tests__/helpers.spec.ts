import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export readStoredPresets', () => {
        expect(subject.readStoredPresets).toBeDefined();
        const t = typeof subject.readStoredPresets;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export writeStoredPresets', () => {
        expect(subject.writeStoredPresets).toBeDefined();
        const t = typeof subject.writeStoredPresets;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
