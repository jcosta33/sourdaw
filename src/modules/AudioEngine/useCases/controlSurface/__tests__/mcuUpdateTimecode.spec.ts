import { describe, it, expect } from 'vitest';
import * as subject from '../mcuUpdateTimecode';

describe('mcuUpdateTimecode', () => {
    it('should export mcuUpdateTimecode', () => {
        expect(subject.mcuUpdateTimecode).toBeDefined();
        const t = typeof subject.mcuUpdateTimecode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
