import { describe, it, expect } from 'vitest';

import * as subject from '../toggleMixer';

describe('toggleMixer', () => {
    it('should export toggleMixer', () => {
        expect(subject.toggleMixer).toBeDefined();
        const time = typeof subject.toggleMixer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
