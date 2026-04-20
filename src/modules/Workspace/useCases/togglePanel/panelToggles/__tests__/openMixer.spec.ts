import { describe, it, expect } from 'vitest';

import * as subject from '../openMixer';

describe('openMixer', () => {
    it('should export openMixer', () => {
        expect(subject.openMixer).toBeDefined();
        const t = typeof subject.openMixer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
