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

    it('clamps generated pitches to the top of the MIDI range', () => {
        // maj7 adds +11; on pitch 120 the third and seventh land at 124 and
        // 131. 131 is not a MIDI pitch — a downstream device sees a wrapped or
        // rejected note. createTranspose and createVelocityCurve both clamp.
        const fx = createChordGenerator('maj7');
        const out = fx.process([n(120)]);
        expect(out.map((x) => x.pitch)).toEqual([120, 124, 127, 127]);
    });

    it('clamps generated pitches to the bottom of the MIDI range', () => {
        // Intervals are non-negative today, so the low bound only bites on a
        // note that is already out of range; the clamp must not pass it through.
        const fx = createChordGenerator('major');
        const out = fx.process([n(-5)]);
        expect(out.map((x) => x.pitch)).toEqual([0, 0, 2]);
    });

    it('should fall back to major intervals for unknown chord types', () => {
        const fx = createChordGenerator('unknown-type-xyz');
        expect(fx.process([n(48)])).toHaveLength(3);
    });
});
