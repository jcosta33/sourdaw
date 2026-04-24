import { describe, it, expect } from 'vitest';

import * as subject from '../createTrack';

describe('createTrack', () => {
    it('should export createTrack', () => {
        expect(subject.createTrack).toBeDefined();
        const time = typeof subject.createTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
