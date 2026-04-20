import { describe, it, expect } from 'vitest';

import * as subject from '../createTrack';

describe('createTrack', () => {
    it('should export createTrack', () => {
        expect(subject.createTrack).toBeDefined();
        const t = typeof subject.createTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
