import { describe, it, expect } from 'vitest';

import * as subject from '../ensureTrackStrip';

describe('ensureTrackStrip', () => {
    it('should export ensureTrackStrip', () => {
        expect(subject.ensureTrackStrip).toBeDefined();
        const time = typeof subject.ensureTrackStrip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
