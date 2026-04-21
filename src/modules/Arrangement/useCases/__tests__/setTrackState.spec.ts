import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackState';

describe('setTrackState', () => {
    it('should export setTrackState', () => {
        expect(subject.setTrackState).toBeDefined();
        const time = typeof subject.setTrackState;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
