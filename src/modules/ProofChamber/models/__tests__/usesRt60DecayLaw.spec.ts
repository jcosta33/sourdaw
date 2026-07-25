import { describe, expect, it } from 'vitest';

import { ALGORITHM_MAP, DEFAULT_PARAMS, SPACE_PRESETS, expandSpacePreset, usesRt60DecayLaw } from '../ProofChamberState';

/**
 * The Decay readout may only claim seconds for algorithms whose engine converts
 * `decay` into an RT60. Getting this wrong is the defect in reverse: the panel
 * used to print a tail length unconditionally, so the module default (plate,
 * whose `decay` is a per-sample tank feedback coefficient) displayed a duration
 * its DSP never produces.
 *
 * Engine-side evidence for each verdict:
 * - fdn-8 / fdn-16 — `fdn.rs` `"decay" => self.rt60 = decay_to_rt60_seconds(value)`
 * - plate          — `proof_chamber.rs` `"decay" => self.decay = value.clamp(0.0, 0.9999)`
 * - spring         — `spring.rs` `"decay" | "feedback" => self.feedback = value.clamp(0.0, 0.95)`
 */
describe('usesRt60DecayLaw', () => {
    it('claims seconds only for the FDN engines', () => {
        expect(usesRt60DecayLaw('fdn-8')).toBe(true);
        expect(usesRt60DecayLaw('fdn-16')).toBe(true);
        expect(usesRt60DecayLaw('plate')).toBe(false);
        expect(usesRt60DecayLaw('spring')).toBe(false);
    });

    it('covers every algorithm the engine map exposes', () => {
        const algorithms = Object.keys(ALGORITHM_MAP) as Array<keyof typeof ALGORITHM_MAP>;

        expect(algorithms).toHaveLength(4);
        for (const algorithm of algorithms) {
            expect(typeof usesRt60DecayLaw(algorithm)).toBe('boolean');
        }
    });

    it('does not claim seconds for the module default', () => {
        // Regression: plate is DEFAULT_PARAMS.algorithm, so an unconditional
        // seconds readout was wrong for the state the panel opens in.
        expect(DEFAULT_PARAMS.algorithm).toBe('plate');
        expect(usesRt60DecayLaw(DEFAULT_PARAMS.algorithm)).toBe(false);
    });

    it('does not claim seconds for any space preset that resolves to plate', () => {
        const spaces = Object.keys(SPACE_PRESETS) as Array<keyof typeof SPACE_PRESETS>;
        const plateBacked = spaces.filter((space) => expandSpacePreset(space).algorithm === 'plate');

        // hall, room, plate, chamber, cathedral, shimmer, infinite — every space
        // except `spring`, which pins its own algorithm.
        expect(plateBacked).toHaveLength(7);
        for (const space of plateBacked) {
            expect(usesRt60DecayLaw(expandSpacePreset(space).algorithm)).toBe(false);
        }
        expect(expandSpacePreset('spring').algorithm).toBe('spring');
    });
});
