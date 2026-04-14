import { describe, it, expect } from 'vitest';
import * as subject from '../detectAndSetSlices';

describe('detectAndSetSlices', () => {
    it('should export detectAndSetSlices', () => {
        expect(subject.detectAndSetSlices).toBeDefined();
        const t = typeof subject.detectAndSetSlices;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
