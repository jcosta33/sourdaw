import { describe, it, expect } from 'vitest';

import * as subject from '../openMixer';

describe('openMixer', () => {
    it('should export openMixer', () => {
        expect(subject.openMixer).toBeDefined();
        const time = typeof subject.openMixer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
