import { describe, it, expect } from 'vitest';

import * as subject from '../getMasterAnalyser';

describe('getMasterAnalyser', () => {
    it('should export getMasterAnalyser', () => {
        expect(subject.getMasterAnalyser).toBeDefined();
        const t = typeof subject.getMasterAnalyser;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
