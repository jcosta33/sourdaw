import { describe, it, expect } from 'vitest';
import * as subject from '../getFermenterPresets';

describe('getFermenterPresets', () => {
    it('should export getFermenterPresets', () => {
        expect(subject.getFermenterPresets).toBeDefined();
        const t = typeof subject.getFermenterPresets;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
