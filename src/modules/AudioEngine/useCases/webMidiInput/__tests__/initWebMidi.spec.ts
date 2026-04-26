import { describe, it, expect } from 'vitest';

import * as subject from '../initWebMidi';

describe('initWebMidi', () => {
    it('should export initWebMidi', () => {
        expect(subject.initWebMidi).toBeDefined();
        const time = typeof subject.initWebMidi;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
