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
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 1 })).toBe(FADER_MAX_GAIN);
    });

    it('leaves a gain lane already on the new ceiling alone', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: FADER_MAX_GAIN })).toBe(FADER_MAX_GAIN);
    });

    it('leaves a gain lane whose range a parameter resolver set alone', () => {
        // Not the exact legacy default, so it is a deliberate range rather than
        // a lane that predates the widening.
        expect(getAutomationLaneCeiling({ parameterId: 'gain', maxValue: 2 })).toBe(2);
    });

    it('never widens a lane for another parameter that happens to stop at unity', () => {
        expect(getAutomationLaneCeiling({ parameterId: 'send-bus-1', maxValue: 1 })).toBe(1);
        expect(getAutomationLaneCeiling({ parameterId: 'pan', maxValue: 1 })).toBe(1);
    });
});
