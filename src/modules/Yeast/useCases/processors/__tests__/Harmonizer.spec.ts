import { describe, it, expect } from 'vitest';

import * as subject from '../Harmonizer';

describe('Harmonizer', () => {
    it('should export Harmonizer', () => {
        expect(subject.Harmonizer).toBeDefined();
        const time = typeof subject.Harmonizer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
