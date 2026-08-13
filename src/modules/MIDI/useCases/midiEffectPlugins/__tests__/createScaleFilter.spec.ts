import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../models/MidiEffectTypes';
import { createScaleFilter } from '../createScaleFilter';

function n(pitch: number): MidiEffectNote {
    return {
        pitch,
        velocity: 100,
        startBeat: 0,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createScaleFilter', () => {
    it('should keep notes in the selected scale and drop others', () => {
        const fx = createScaleFilter(0, 'major');
        const out = fx.process([n(60), n(61)]);
        expect(out.map((x) => x.pitch)).toEqual([60]);
    });

    it('should use major scale when the scale name is unknown', () => {
        const fx = createScaleFilter(0, 'not-a-scale');
        expect(fx.process([n(62)]).length).toBeGreaterThan(0);
    });
});
