import { describe, it, expect } from 'vitest';
import * as subject from '../applyPreset';

describe('applyPreset', () => {
    it('should export applyPreset', () => {
        expect(subject.applyPreset).toBeDefined();
        const t = typeof subject.applyPreset;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
