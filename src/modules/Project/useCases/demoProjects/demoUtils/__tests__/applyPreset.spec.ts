import { describe, it, expect } from 'vitest';

import * as subject from '../applyPreset';

describe('applyPreset', () => {
    it('should export applyPreset', () => {
        expect(subject.applyPreset).toBeDefined();
        const time = typeof subject.applyPreset;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
