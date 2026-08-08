import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mapFermenterParamToDspParam } from '#/modules/Fermenter/useCases';

import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../engine/FermenterNode';
import { initSync, FermenterInstance } from '../daw_dsp.js';

const FRAMES = 128;
const BLOCKS = 4;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

/**
 * Ordinal pin for the whole offline automation map, against the shipped binary.
 *
 * The scheduled path bypasses the WASM string bridge: TS posts an *ordinal* and
 * Rust indexes `AUTOMATION_PARAM_NAMES` positionally. Nothing type-checks that
 * index `n` means the same parameter on both sides, so a transposition
 * repoints automation at a different parameter — an automated level ride
 * bouncing as a filter sweep — with no compile error and no test failure.
 *
 * The previous guard pinned ordinal 15 only. Every other transposition was
 * silent: swapping ordinals 0 and 1 left `cargo test -p daw-dsp` at
 * `505 passed; 0 failed`, exit 0.
 *
 * **A name pin turned out to be writable after all.** The claim it was not
 * rested on the two sides spelling parameters differently on purpose. They do —
 * and `mapFermenterParamToDspParam` is the production translation between those
 * spellings, the same one the live path uses to reach `set_param`. It
 * reproduces all sixteen Rust names from the sixteen TS keys, including every
 * spelling cited as the reason this was impossible: `oscLevel` → `osc_level`,
 * `lfoPitchAmount` → `mod_lfo_to_pitch`, `filterCutoff` → `cutoff`. So the
 * population is derived, not listed, and this scales to 105 rows.
 *
 * Per ordinal, three renders of one note through a real `FermenterInstance`:
 *
 *  - `baseline` — the probe parameter set **by name** to `from`
 *  - `byName`   — the probe parameter set **by name** to `to`
 *  - `byId`     — the probe parameter set **by ordinal** to `to`
 *
 * and two assertions:
 *
 *  1. `byName !== baseline` — the probe actually moves this engine. Without it
 *     the pin is vacuous: a parameter whose probe changes nothing renders
 *     identically under every ordinal, so a transposition would agree too. This
 *     is the trap that let an RT guard sit at the default `unison_voices` of 1,
 *     where the allocating branch early-returns — which is exactly why
 *     `unisonSpread` below carries a prelude that raises the voice count.
 *  2. `byId === byName`, sample for sample — the ordinal names *this*
 *     parameter, not merely *some* parameter.
 *
 * A transposition fails (2) in both directions: the by-id arm either renders a
 * different parameter's change, or renders nothing and collapses onto baseline.
 */

type OrdinalProbe = {
    /** Parameters set by name, in both arms, to make the probed one audible. */
    prelude?: ReadonlyArray<readonly [string, number]>;
    from: number;
    to: number;
    /** Why these two values differ to the engine. */
    why: string;
};

/**
 * Engine indices are `voice.rs`: 0 wavetable, 1 polyblep, 2 FM, 3 Karplus-Strong,
 * 4 granular, 5 additive, 6 sampler. A parameter belonging to an engine the
 * default patch does not select is dead until its engine is selected, so those
 * rows carry a prelude rather than a wider value range.
 */
const ORDINAL_PROBES: Readonly<Record<string, OrdinalProbe>> = {
    oscLevel: { from: 0.8, to: 0.15, why: 'oscillator amplitude, away from the 0.8 default' },
    filterCutoff: { from: 5000, to: 250, why: 'cutoff below the note partials rather than above them' },
    filterResonance: { from: 1, to: 18, why: 'near-self-oscillating Q against the flat default' },
    lfoRate: {
        prelude: [['lfo_filter_amount', 1]],
        from: 0,
        to: 30,
        why: 'a stopped LFO modulates nothing; the prelude gives it a destination',
    },
    lfoFilterAmount: {
        prelude: [['lfo_rate', 8]],
        from: 0,
        to: 1,
        why: 'depth is dead while the LFO is stopped; the prelude runs it',
    },
    lfoPitchAmount: {
        prelude: [['lfo_rate', 8]],
        from: 0,
        to: 1,
        why: 'depth is dead while the LFO is stopped; the prelude runs it',
    },
    filterEnvAmount: { from: 0.5, to: -1, why: 'inverts the filter envelope from the 0.5 default' },
    msegToFilter: { from: 0, to: 1, why: 'MSEG→filter depth off versus full' },
    unisonSpread: {
        prelude: [['unison_voices', 8]],
        from: 0.7,
        to: 0,
        why: 'stereo spread across a unison bank; at the default of 1 voice there is no bank to spread',
    },
    fmLevel2: { prelude: [['engine', 2]], from: 0.8, to: 0, why: 'operator 2 level, on the FM engine' },
    fmFeedback: { prelude: [['engine', 2]], from: 0, to: 1, why: 'operator feedback, on the FM engine' },
    noiseLevel: { from: 0, to: 1, why: 'noise layer silent versus full against a tonal note' },
    grainDensity: { prelude: [['engine', 4]], from: 20, to: 100, why: 'grains per second, on the granular engine' },
    grainSize: { prelude: [['engine', 4]], from: 50, to: 400, why: 'grain length, on the granular engine' },
    grainSpray: { prelude: [['engine', 4]], from: 0.1, to: 1, why: 'grain position jitter, on the granular engine' },
    oscWaveform: { from: 0, to: 2, why: 'sine versus square wavetable; neither is the saw default' },
};

type RenderInput = {
    prelude?: ReadonlyArray<readonly [string, number]>;
    apply: (instance: FermenterInstance) => void;
};

function render({ prelude, apply }: RenderInput): number[] {
    const instance = new FermenterInstance(48_000, 8);
    try {
        for (const [name, value] of prelude ?? []) {
            instance.set_param(name, value);
        }
        apply(instance);
        instance.note_on(60, 100);
        const samples: number[] = [];
        for (let block = 0; block < BLOCKS; block++) {
            // Read immediately: a later allocation can detach the buffer.
            const leftBase = instance.process(FRAMES);
            const rightBase = instance.get_right_ptr();
            samples.push(
                ...new Float32Array(wasm.memory.buffer, leftBase, FRAMES),
                ...new Float32Array(wasm.memory.buffer, rightBase, FRAMES)
            );
        }
        return samples;
    } finally {
        instance.free();
    }
}

function totalDifference(left: number[], right: number[]): number {
    return left.reduce((sum, sample, index) => sum + Math.abs(sample - (right[index] ?? 0)), 0);
}

describe('checked-in Fermenter WASM automation ordinals', () => {
    it('derives every Rust parameter name from its TS key through the production translation', () => {
        // The claim that made a name pin look unwritable, tested rather than
        // assumed. If this ever stops holding, the pin below silently starts
        // comparing a parameter against itself under a name Rust ignores — so
        // this runs first and names the failure.
        const translated = Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).map((paramId) =>
            mapFermenterParamToDspParam({ paramId })
        );

        expect(translated).toEqual([
            'osc_level',
            'cutoff',
            'resonance',
            'lfo_rate',
            'lfo_filter_amount',
            'mod_lfo_to_pitch',
            'mod_env_to_filter',
            'mseg_to_filter',
            'unison_spread',
            'fm_level2',
            'fm_feedback',
            'noise_level',
            'grain_density',
            'grain_size',
            'grain_spray',
            'osc_waveform',
        ]);
        // Every ordinal in the map has a probe, so no row can be skipped by
        // omission — adding an ordinal without a probe fails here, not silently.
        expect(Object.keys(ORDINAL_PROBES).sort()).toEqual(Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).sort());
        // The ordinals are a dense 0..n-1 range, which is what indexing
        // `AUTOMATION_PARAM_NAMES` positionally requires.
        expect(Object.values(FERMENTER_AUTOMATION_PARAM_IDS).sort((a, b) => a - b)).toEqual(
            Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).map((_, index) => index)
        );
    });

    it.each(Object.entries(FERMENTER_AUTOMATION_PARAM_IDS))(
        'ordinal for %s reaches that parameter and no other',
        (paramId, ordinal) => {
            const probe = ORDINAL_PROBES[paramId];
            if (!probe) {
                throw new Error(`no probe for ${paramId}`);
            }
            const dspName = mapFermenterParamToDspParam({ paramId });

            const baseline = render({ prelude: probe.prelude, apply: (i) => i.set_param(dspName, probe.from) });
            const byName = render({ prelude: probe.prelude, apply: (i) => i.set_param(dspName, probe.to) });
            const byId = render({ prelude: probe.prelude, apply: (i) => i.set_param_by_id(ordinal, probe.to) });

            // (1) Liveness. Without this the equality below is satisfied by two
            // renders that both did nothing.
            expect(totalDifference(byName, baseline)).toBeGreaterThan(0.01);
            // (2) The ordinal is this parameter.
            expect(totalDifference(byId, byName)).toBe(0);
        }
    );
});
