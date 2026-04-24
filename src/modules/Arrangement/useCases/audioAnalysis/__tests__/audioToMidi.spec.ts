import { describe, it, expect } from 'vitest';

import * as subject from '../audioToMidi';

describe('audioToMidi', () => {
    it('should export audioToMidi', () => {
        expect(subject.audioToMidi).toBeDefined();
        const time = typeof subject.audioToMidi;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
