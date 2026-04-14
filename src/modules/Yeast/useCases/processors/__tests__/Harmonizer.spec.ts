import { describe, it, expect } from 'vitest';
import * as subject from '../Harmonizer';

describe('Harmonizer', () => {
    it('should export Harmonizer', () => {
        expect(subject.Harmonizer).toBeDefined();
        const t = typeof subject.Harmonizer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
