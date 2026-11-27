import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { planStartTrim } from '../planStartTrim';

function midiClip(overrides: Parameters<typeof ClipDummy.create>[0] = {}) {
    return ClipDummy.create({ type: 'midi', startBeat: 0, endBeat: 8, midiOffsetBeats: 0, ...overrides });
}

describe('planStartTrim', () => {
    it('plans nothing when the requested start does not precede the clip end', () => {
        expect(planStartTrim(midiClip(), 8, undefined, undefined)).toBeNull();
    });

    it('advances a MIDI clip head and the offset together and shifts no rows without a loop', () => {
        const plan = planStartTrim(midiClip(), 2, undefined, undefined);

        expect(plan).toMatchObject({ clip: { startBeat: 2, midiOffsetBeats: 2 }, rowShiftBeats: 0 });
    });

    it('refuses a MIDI trim whose own head is not finite', () => {
        expect(planStartTrim(midiClip({ startBeat: Number.NaN }), 2, undefined, undefined)).toBe('refused');
    });

    it('refuses a MIDI trim of a clip that carries a non-finite audio offset', () => {
        expect(planStartTrim(midiClip({ audioOffsetBeats: Number.POSITIVE_INFINITY }), 2, undefined, undefined)).toBe(
            'refused'
        );
    });

    it('refuses a MIDI trim when the stored offset leaves a non-finite figure', () => {
        expect(planStartTrim(midiClip({ midiOffsetBeats: Number.POSITIVE_INFINITY }), 2, undefined, undefined)).toBe(
            'refused'
        );
    });

    it('restores a recorded offset verbatim and shifts the rows by the exact reverse', () => {
        const plan = planStartTrim(midiClip({ startBeat: 2, midiOffsetBeats: 2 }), 0, undefined, 7);

        expect(plan).toMatchObject({ clip: { startBeat: 0, midiOffsetBeats: 7 }, rowShiftBeats: 7 });
    });
});
