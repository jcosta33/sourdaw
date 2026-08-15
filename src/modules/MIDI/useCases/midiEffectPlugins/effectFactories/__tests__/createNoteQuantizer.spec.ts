import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../../models/MidiEffectTypes';
import { createNoteQuantizer } from '../createNoteQuantizer';

function n(startBeat: number): MidiEffectNote {
    return {
        pitch: 60,
        velocity: 100,
        startBeat,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createNoteQuantizer', () => {
    it('should move startBeat toward the grid by strength', () => {
        const fx = createNoteQuantizer(0.25, 1);
        const out = fx.process([n(0.2)]);
        expect(out[0]!.startBeat).toBeCloseTo(0.25);
    });

    it('should not move when strength is zero', () => {
        const fx = createNoteQuantizer(0.5, 0);
        expect(fx.process([n(0.11)])[0]!.startBeat).toBeCloseTo(0.11);
    });
});
