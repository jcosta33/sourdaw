import { describe, it, expect } from 'vitest';
import * as subject from '../getTrackAnalyser';

describe('getTrackAnalyser', () => {
    it('should export getTrackAnalyser', () => {
        expect(subject.getTrackAnalyser).toBeDefined();
        const t = typeof subject.getTrackAnalyser;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
