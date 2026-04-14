import { describe, it, expect } from 'vitest';
import * as subject from '../getUserPresets';

describe('getUserPresets', () => {
    it('should export getUserPresets', () => {
        expect(subject.getUserPresets).toBeDefined();
        const t = typeof subject.getUserPresets;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
