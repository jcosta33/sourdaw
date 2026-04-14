import { describe, it, expect } from 'vitest';
import * as subject from '../mcuSetFader';

describe('mcuSetFader', () => {
    it('should export mcuSetFader', () => {
        expect(subject.mcuSetFader).toBeDefined();
        const t = typeof subject.mcuSetFader;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
