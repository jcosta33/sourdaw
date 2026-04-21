import { describe, it, expect } from 'vitest';

import * as subject from '../getTrackAnalyser';

describe('getTrackAnalyser', () => {
    it('should export getTrackAnalyser', () => {
        expect(subject.getTrackAnalyser).toBeDefined();
        const time = typeof subject.getTrackAnalyser;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
