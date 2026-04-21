import { describe, it, expect } from 'vitest';

import * as subject from '../getTrackStrip';

describe('getTrackStrip', () => {
    it('should export getTrackStrip', () => {
        expect(subject.getTrackStrip).toBeDefined();
        const time = typeof subject.getTrackStrip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
