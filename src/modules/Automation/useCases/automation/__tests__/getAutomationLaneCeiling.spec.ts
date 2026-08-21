import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { getAutomationLaneCeiling } from '../getAutomationLaneCeiling';

/**
 * The stored `maxValue` is durable CRDT state and is deliberately never
 * rewritten — see the note on `automationStore`'s `sanitize`. This derivation
 * is the whole of how a legacy gain lane reaches the fader's real ceiling, so
 * it is what makes the two lanes in one project share a Y scale.
 */
describe('getAutomationLaneCeiling', () => {
    it('reads a legacy gain lane up to the fader ceiling', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 1, minValue: 0 })).toBe(FADER_MAX_GAIN);
    });

    it('leaves a gain lane already on the new ceiling alone', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: FADER_MAX_GAIN, minValue: 0 })).toBe(
            FADER_MAX_GAIN
        );
    });

    it('leaves a gain lane whose range a parameter resolver set alone', () => {
        // Not the exact legacy default, so it is a deliberate range rather than
        // a lane that predates the widening.
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 2, minValue: 0 })).toBe(2);
    });

    it('never widens a lane for another parameter that happens to stop at unity', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'send-bus-1', maxValue: 1, minValue: 0 })).toBe(1);
        expect(getAutomationLaneCeiling({ parameterId: 'pan', maxValue: 1, minValue: 0 })).toBe(1);
    });

    /**
     * A gain lane with `minValue < 0` is a **decibel** lane —
     * `automationScheduling.ts` reads exactly that predicate and writes
     * `dbToGain(value)`. Its `maxValue: 1` means `+1 dB`, so widening it to the
     * linear fader ceiling would report `+1.995 dB`: right number, wrong unit,
     * and about a 26x error once the exponent is applied.
     */
    it('never widens a decibel gain lane, whose unity means +1 dB', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 1, minValue: -60 })).toBe(1);
    });

    /**
     * A clip's own gain lane is bounded by the clip, not by the track fader
     * this widening is about.
     */
    it('never widens a clip gain lane', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 1, minValue: 0, clipId: 'clip-1' })).toBe(1);
    });
});
