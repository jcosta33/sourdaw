import { describe, it, expect } from 'vitest';
import * as subject from '../ScaleQuantizer';

describe('ScaleQuantizer', () => {
    it('should export ScaleQuantizer', () => {
        expect(subject.ScaleQuantizer).toBeDefined();
        const t = typeof subject.ScaleQuantizer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
