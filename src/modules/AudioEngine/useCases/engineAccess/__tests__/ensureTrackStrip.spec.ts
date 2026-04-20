import { describe, it, expect } from 'vitest';

import * as subject from '../ensureTrackStrip';

describe('ensureTrackStrip', () => {
    it('should export ensureTrackStrip', () => {
        expect(subject.ensureTrackStrip).toBeDefined();
        const t = typeof subject.ensureTrackStrip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
