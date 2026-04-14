import { describe, it, expect } from 'vitest';
import * as subject from '../MidiRack';

describe('MidiRack', () => {
    it('should export MidiRack', () => {
        expect(subject.MidiRack).toBeDefined();
        const t = typeof subject.MidiRack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
