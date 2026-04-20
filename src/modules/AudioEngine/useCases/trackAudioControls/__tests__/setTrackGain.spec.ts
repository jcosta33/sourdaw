import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackGain';

describe('setTrackGain', () => {
    it('should export setTrackGain', () => {
        expect(subject.setTrackGain).toBeDefined();
        const t = typeof subject.setTrackGain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
