import { describe, it, expect } from 'vitest';

import * as subject from '../getAudioContext';

describe('getAudioContext', () => {
    it('should export getAudioContext', () => {
        expect(subject.getAudioContext).toBeDefined();
        const time = typeof subject.getAudioContext;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
