import { describe, it, expect } from 'vitest';

import { MIDI_EFFECT_FACTORIES } from '../registry';

describe('MIDI_EFFECT_FACTORIES', () => {
    it('should use unique factory ids', () => {
        const ids = MIDI_EFFECT_FACTORIES.map((freq) => freq.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should produce a MidiEffect with id and process from each entry', () => {
        for (const entry of MIDI_EFFECT_FACTORIES) {
            const fx = entry.create();
            expect(typeof fx.id).toBe('string');
            expect(typeof fx.name).toBe('string');
            expect(typeof fx.process).toBe('function');
            expect(fx.process([])).toEqual([]);
        }
    });
});
