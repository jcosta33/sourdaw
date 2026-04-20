import { describe, it, expect } from 'vitest';

import * as subject from '../setMidiInputTrack';

describe('setMidiInputTrack', () => {
    it('should export setMidiInputTrack', () => {
        expect(subject.setMidiInputTrack).toBeDefined();
        const t = typeof subject.setMidiInputTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
