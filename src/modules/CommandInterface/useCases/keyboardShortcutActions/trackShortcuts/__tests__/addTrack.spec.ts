import { describe, it, expect } from 'vitest';

import * as subject from '../addTrack';

describe('addTrack', () => {
    it('should export addTrack', () => {
        expect(subject.addTrack).toBeDefined();
        const time = typeof subject.addTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
