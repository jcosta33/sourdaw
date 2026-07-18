import { describe, it, expect } from 'vitest';

import { type MidiNote } from '#/modules/MIDI/models/MidiEffectTypes';

import { createChordGenerator } from '../createChordGenerator';

function n(pitch: number): MidiNote {
    return {
        pitch,
        velocity: 100,
        startBeat: 0,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createChordGenerator', () => {
    it('should expand one note into a major triad by default', () => {
        const fx = createChordGenerator('major');
        const out = fx.process([n(60)]);
        expect(out.map((x) => x.pitch).sort((alpha, b) => alpha - b)).toEqual([60, 64, 67]);
    });

    it('should fall back to major intervals for unknown chord types', () => {
        const fx = createChordGenerator('unknown-type-xyz');
        expect(fx.process([n(48)])).toHaveLength(3);
    });
});
