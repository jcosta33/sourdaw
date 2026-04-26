import { describe, it, expect } from 'vitest';

import * as subject from '../getMasterAnalyser';

describe('getMasterAnalyser', () => {
    it('should export getMasterAnalyser', () => {
        expect(subject.getMasterAnalyser).toBeDefined();
        const time = typeof subject.getMasterAnalyser;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
