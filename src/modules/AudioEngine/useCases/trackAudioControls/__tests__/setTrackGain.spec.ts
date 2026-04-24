import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackGain';

describe('setTrackGain', () => {
    it('should export setTrackGain', () => {
        expect(subject.setTrackGain).toBeDefined();
        const time = typeof subject.setTrackGain;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
