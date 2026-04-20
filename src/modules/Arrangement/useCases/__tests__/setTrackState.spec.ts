import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackState';

describe('setTrackState', () => {
    it('should export setTrackState', () => {
        expect(subject.setTrackState).toBeDefined();
        const t = typeof subject.setTrackState;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
