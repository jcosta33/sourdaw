import { describe, it, expect } from 'vitest';
import * as subject from '../bilinearPatch';

describe('bilinearPatch', () => {
    it('should export bilinearPatch', () => {
        expect(subject.bilinearPatch).toBeDefined();
        const t = typeof subject.bilinearPatch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export lerpPatch', () => {
        expect(subject.lerpPatch).toBeDefined();
        const t = typeof subject.lerpPatch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
