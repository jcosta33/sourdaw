import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { chamberDecayEqGate, DECAY_EQ_HEADROOM_CEILING } from '../ProofChamberAlgorithmGating';
import { DEFAULT_PARAMS, type ProofChamberAlgorithm } from '../ProofChamberState';

/**
 * The Decay Rate EQ refuses to shape a loop that has nothing left to lend, and
 * the panel has to say so — but the panel cannot ask the engine, so it declares
 * the Decay values at which the refusal starts. A declared number nobody checks
 * is exactly the drift this repo's census specs exist to catch, so this is the
 * weld.
 *
 * The measurement lives in Rust, in
 * `crates/proof-chamber/tests/decay_eq_parameter_surface.rs`, which renders the
 * plate at 0.999 and requires bit-identity with never writing the bands. This
 * file reads that test's own numbers back out of the source and requires the
 * declaration to agree, so the two cannot drift apart in either direction.
 *
 * Read rather than imported for the reason every other Rust weld in this repo
 * gives: production ships to a browser and cannot run `cargo`.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const DECAY_EQ_SOURCE = join(REPO_ROOT, 'crates/proof-chamber/src/decay_eq.rs');
const DECAY_EQ_GUARD = join(REPO_ROOT, 'crates/proof-chamber/tests/decay_eq_parameter_surface.rs');

function rustConstant(name: string): number {
    const source = readFileSync(DECAY_EQ_SOURCE, 'utf8');
    const match = new RegExp(String.raw`const ${name}: f32 = (-?\d+(?:\.\d+)?);`).exec(source);
    expect(match, `${name} is no longer a plain numeric constant in decay_eq.rs`).not.toBeNull();
    return Number(match![1]);
}

/** The decay the Rust guard proves the plate renders bit-identically at. */
function measuredPlateCeiling(): number {
    const guard = readFileSync(DECAY_EQ_GUARD, 'utf8');
    const match = /let base: Vec<Write> = vec!\[\("decay", (\d+\.\d+)_f32\)\];/.exec(guard);
    expect(match, 'the top-of-range guard no longer opens with a literal decay write').not.toBeNull();
    return Number(match![1]);
}

/**
 * The smallest per-pass loss, in dB, at which the stage still designs a filter.
 *
 * A band asks for `budget * (1 - 1/4)` of the loop's loss at full boost, where
 * `budget = headroom - LIMIT_MARGIN_DB`, and anything under
 * `MIN_DESIGNABLE_GAIN_DB` becomes an exact pass-through — so the stage falls
 * silent below `LIMIT_MARGIN_DB + MIN_DESIGNABLE_GAIN_DB / 0.75`.
 */
function minimumUsefulHeadroomDb(): number {
    return rustConstant('LIMIT_MARGIN_DB') + rustConstant('MIN_DESIGNABLE_GAIN_DB') / 0.75;
}

describe('the Decay EQ headroom ceiling the panel declares', () => {
    it('is the decay the engine guard measures, not a number typed beside it', () => {
        // Presence pins: a regex that stopped matching would make both
        // comparisons below vacuous.
        expect(rustConstant('LIMIT_MARGIN_DB')).toBeGreaterThan(0);
        expect(minimumUsefulHeadroomDb()).toBeGreaterThan(0);

        expect(DECAY_EQ_HEADROOM_CEILING.plate).toBe(measuredPlateCeiling());
    });

    it('sits above the flat-loop arithmetic, because every real loop has a damper in it', () => {
        // `decay^2` per half-traversal, so the flat-loop floor is
        // `10^(-minimum/40)`. The measured ceiling must be *higher* than that:
        // the tank's damper takes far more per pass at high frequencies, so the
        // upper bands keep shaping after the low ones have stopped. A declared
        // ceiling at or below the flat figure would be disabling a control that
        // still works.
        const flatLoopFloor = 10 ** (-minimumUsefulHeadroomDb() / 40);
        expect(DECAY_EQ_HEADROOM_CEILING.plate!).toBeGreaterThan(flatLoopFloor);
    });

    it('names no engine whose loop never reaches the floor', () => {
        // The FDN's absorption is a fraction of RT60 rather than a fixed dB, so
        // it keeps opening headroom above 2 kHz and measures as shaping even at
        // 0.999. The spring clamps `feedback` at 0.95 — 0.446 dB — an order of
        // magnitude above the floor. A row for either would disable a control
        // that works.
        for (const algorithm of ['fdn-8', 'fdn-16', 'spring'] as const) {
            expect(DECAY_EQ_HEADROOM_CEILING[algorithm]).toBeUndefined();
            expect(chamberDecayEqGate({ algorithm, freeze: false, decay: 0.999 }).isInert).toBe(false);
        }
    });
});

describe('the gate the panel actually calls', () => {
    it('refuses at the declared ceiling and allows below it', () => {
        const ceiling = DECAY_EQ_HEADROOM_CEILING.plate!;
        const algorithm: ProofChamberAlgorithm = 'plate';
        expect(chamberDecayEqGate({ algorithm, freeze: false, decay: ceiling }).isInert).toBe(true);
        expect(chamberDecayEqGate({ algorithm, freeze: false, decay: ceiling - 0.01 }).isInert).toBe(false);
    });

    it('refuses under Freeze at any Decay, and says why in its own words', () => {
        const frozen = chamberDecayEqGate({ algorithm: 'plate', freeze: true, decay: 0.3 });
        expect(frozen.isInert).toBe(true);
        expect(frozen.explanation).toContain('Freeze');
        expect(frozen.explanation).toContain('unity gain');

        // The two reasons must not collapse into one sentence: a user at the
        // top of the Decay range and a user with Freeze engaged need different
        // instructions to get the control back.
        const starved = chamberDecayEqGate({ algorithm: 'plate', freeze: false, decay: 0.999 });
        expect(starved.isInert).toBe(true);
        expect(starved.explanation).not.toEqual(frozen.explanation);
        expect(starved.explanation).toContain('Turn Decay down');
    });

    it('still defers to the engine-gap census on an algorithm with no loop at all', () => {
        const reverse = chamberDecayEqGate({ algorithm: 'reverse', freeze: false, decay: 0.3 });
        expect(reverse.isInert).toBe(true);
        expect(reverse.explanation).toContain('no feedback path');
    });

    it('is live at the shipped defaults, which is what stops a blanket refusal', () => {
        const shipped = chamberDecayEqGate({
            algorithm: DEFAULT_PARAMS.algorithm,
            freeze: DEFAULT_PARAMS.freeze,
            decay: DEFAULT_PARAMS.decay,
        });
        expect(shipped.isInert).toBe(false);
        expect(shipped.explanation).toBeNull();
    });
});
