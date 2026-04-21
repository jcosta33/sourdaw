import { describe, it, expect } from 'vitest';

import * as subject from '../setMidiInputTrack';

describe('setMidiInputTrack', () => {
    it('should export setMidiInputTrack', () => {
        expect(subject.setMidiInputTrack).toBeDefined();
        const time = typeof subject.setMidiInputTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
