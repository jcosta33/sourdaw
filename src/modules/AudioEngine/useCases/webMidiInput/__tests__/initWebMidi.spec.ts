import { describe, it, expect } from 'vitest';

import * as subject from '../initWebMidi';

describe('initWebMidi', () => {
    it('should export initWebMidi', () => {
        expect(subject.initWebMidi).toBeDefined();
        const t = typeof subject.initWebMidi;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
