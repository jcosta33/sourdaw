import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../../models/MidiEffectTypes';
import { createCCMap } from '../createCCMap';

function note(overrides: Partial<MidiEffectNote> = {}): MidiEffectNote {
    return {
        pitch: 60,
        velocity: 100,
        startBeat: 0,
        durationBeats: 0.25,
        channel: 0,
        ...overrides,
    };
}

describe('createCCMap', () => {
    it('should return a passthrough MidiEffect that passes notes unchanged', () => {
        const fx = createCCMap(1, 2);
        const inputs = [note({ pitch: 48 }), note({ pitch: 72 })];
        expect(fx.process(inputs)).toEqual(inputs);
        expect(fx.id).toBe('midi-fx-cc-map');
        expect(fx.name).toContain('CC Map');
    });
});
