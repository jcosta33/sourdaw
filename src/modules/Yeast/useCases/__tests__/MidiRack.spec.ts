import { describe, it, expect } from 'vitest';

import * as subject from '../MidiRack';

describe('MidiRack', () => {
    it('should export MidiRack', () => {
        expect(subject.MidiRack).toBeDefined();
        const time = typeof subject.MidiRack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
