import { describe, it, expect } from 'vitest';

import * as subject from '../audioToMidi';

describe('audioToMidi', () => {
    it('should export audioToMidi', () => {
        expect(subject.audioToMidi).toBeDefined();
        const t = typeof subject.audioToMidi;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
