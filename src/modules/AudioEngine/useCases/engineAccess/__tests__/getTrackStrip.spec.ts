import { describe, it, expect } from 'vitest';

import * as subject from '../getTrackStrip';

describe('getTrackStrip', () => {
    it('should export getTrackStrip', () => {
        expect(subject.getTrackStrip).toBeDefined();
        const t = typeof subject.getTrackStrip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
