import { describe, it, expect } from 'vitest';
import * as subject from '../getSynthParamsForTrack';

describe('getSynthParamsForTrack', () => {
    it('should export getSynthParamsForTrack', () => {
        expect(subject.getSynthParamsForTrack).toBeDefined();
        const t = typeof subject.getSynthParamsForTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
