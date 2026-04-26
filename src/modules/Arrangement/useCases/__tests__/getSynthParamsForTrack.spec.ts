import { describe, it, expect } from 'vitest';

import * as subject from '../getSynthParamsForTrack';

describe('getSynthParamsForTrack', () => {
    it('should export getSynthParamsForTrack', () => {
        expect(subject.getSynthParamsForTrack).toBeDefined();
        const time = typeof subject.getSynthParamsForTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
