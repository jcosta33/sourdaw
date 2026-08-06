/**
 * Crust's three engine gates, measured against the engine that answers them.
 *
 * `CrustEngine` carries three boolean parameters that no descriptor declared:
 * `attack_auto` and `release_auto` (`crust/engine.rs`, `apply_envelope`) pick
 * between the algorithm profile's time constants and the panel's own Attack and
 * Release values, and `sat_enabled` (`crust/saturator.rs`, `is_idle`) is the
 * first branch of the saturation stage. All three default to a state that
 * *ignores* a declared control: attack and release auto default on, so
 * `crust/attack` and `crust/release` — both declared, both automatable — reach
 * the engine and are then discarded; saturation defaults off, so `crust/satDrive`
 * and `crust/satMix` are discarded the same way.
 *
 * Rendered through the checked-in wasm rather than argued about in TypeScript,
 * and each gate is driven between *both* of its values with its companion
 * control moved off the default — a gate held at its default is exactly the
 * shape of dead-control guard that passes without executing the branch it
 * claims to cover.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getPluginById, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { initSync, CrustInstance } from '../daw_dsp.js';

const FRAMES = 512;
const BLOCKS = 24;
const SAMPLE_RATE = 48_000;
/** Tone loud enough to sit over the ceiling, so the gain stage is working. */
const PROBE_HZ = 220;
/** Isolated transients: what separates a fast envelope from a slow one. */
const TRANSIENT_PERIOD = 4_800;
const TRANSIENT_WIDTH = 24;

const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

/**
 * The camelCase descriptor ids, mapped exactly as `crustProcessor.ts`'s
 * `PARAM_MAP` maps them. Written out rather than imported because that module
 * ends in `registerProcessor` and cannot be loaded outside a worklet; the weld
 * between the two is held by `descriptorEngineParamWeld.spec.ts`.
 */
const ENGINE_NAME: Record<string, string> = {
    attack: 'attack',
    attackAuto: 'attack_auto',
    release: 'release',
    releaseAuto: 'release_auto',
    satEnabled: 'sat_enabled',
    satDrive: 'sat_drive',
    satMix: 'sat_mix',
    algorithm: 'algorithm',
    ceiling: 'ceiling',
    gain: 'gain',
    lookahead: 'lookahead',
    oversampling: 'oversampling',
};

/**
 * Render the probe programme with a patch expressed in **descriptor** ids, each
 * value passed through the delivery law the app applies before the write leaves
 * for the DSP. So a value this file renders is a value the product can actually
 * deliver, not one only this file can construct.
 */
function render(patch: Record<string, number>): Float32Array {
    const crust = new CrustInstance(SAMPLE_RATE);
    try {
        for (const [paramId, value] of Object.entries(patch)) {
            const engineName = ENGINE_NAME[paramId];
            if (!engineName) {
                throw new Error(`no engine name for crust/${paramId}`);
            }
            crust.set_param(engineName, quantiseDeviceParameterValue({ deviceType: 'crust', paramId, value }));
        }

        const inputLeftPtr = crust.get_input_left_ptr();
        const inputRightPtr = crust.get_input_right_ptr();
        const rendered = new Float32Array(FRAMES * BLOCKS);
        let sampleIndex = 0;

        for (let block = 0; block < BLOCKS; block++) {
            // Re-viewed each block: a wasm `memory.grow()` detaches the buffer.
            const inputLeft = new Float32Array(wasm.memory.buffer, inputLeftPtr, FRAMES);
            const inputRight = new Float32Array(wasm.memory.buffer, inputRightPtr, FRAMES);
            for (let frame = 0; frame < FRAMES; frame++) {
                const phase = (2 * Math.PI * PROBE_HZ * sampleIndex) / SAMPLE_RATE;
                const transient = sampleIndex % TRANSIENT_PERIOD < TRANSIENT_WIDTH ? 3.5 : 0;
                inputLeft[frame] = 0.9 * Math.sin(phase) + transient;
                inputRight[frame] = 0.9 * Math.sin(phase) - transient;
                sampleIndex++;
            }
            const outputPtr = crust.process(FRAMES);
            rendered.set(new Float32Array(wasm.memory.buffer, outputPtr, FRAMES), block * FRAMES);
        }

        return rendered;
    } finally {
        crust.free();
    }
}

/** Peak absolute difference between two renders, in the sample domain. */
function peakDifference(left: Float32Array, right: Float32Array): number {
    let worst = 0;
    for (let index = 0; index < left.length; index++) {
        worst = Math.max(worst, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
    }
    return worst;
}

/** The gates, and the companion control each one decides the fate of. */
const GATES = [
    {
        gateId: 'attackAuto',
        companionId: 'attack',
        // Auto on takes `Transparent`'s 0 ms attack; auto off takes the
        // declared control. Lookahead at its maximum, because the limiter
        // clamps the attack ramp to the look-ahead budget (`clamp_attack`) and
        // a 2 ms window leaves almost nothing for a 100 ms ramp to occupy.
        base: { ceiling: -0.3, lookahead: 10, attack: 100 },
    },
    {
        gateId: 'releaseAuto',
        companionId: 'release',
        base: { ceiling: -0.3, lookahead: 2, release: 400 },
    },
    {
        gateId: 'satEnabled',
        companionId: 'satDrive',
        base: { ceiling: -0.3, lookahead: 2, satDrive: 12, satMix: 100, oversampling: 4 },
    },
] as const;

describe('checked-in Crust WASM gates', () => {
    it.each(GATES)('renders $gateId on unlike $gateId off', ({ gateId, base }) => {
        const off = render({ ...base, [gateId]: 0 });
        const on = render({ ...base, [gateId]: 1 });

        // Not "differs somewhere in the noise floor": an audible difference on
        // a programme that peaks near full scale.
        expect(peakDifference(off, on)).toBeGreaterThan(0.01);
    });

    it.each(GATES)('leaves $companionId inert while $gateId sits at the engine default', (gate) => {
        const { gateId, companionId, base } = gate;

        // Why the declaration is not cosmetic. Every gate defaults to the state
        // that discards its companion, and the companion is declared and
        // automatable — so without a way to move the gate, a lane drawn on the
        // companion renders nothing at all.
        const declaredDefault = getPluginById('crust')?.parameters.find(
            (candidate) => candidate.id === gateId
        )?.defaultValue;
        expect(declaredDefault, `crust/${gateId} is not declared`).toBeDefined();

        const atDefault = { ...base, [gateId]: declaredDefault ?? 0 };
        const companionMoved = render(atDefault);
        const companionNeutral = render({ ...atDefault, [companionId]: 0 });

        expect(
            peakDifference(companionMoved, companionNeutral),
            `crust/${companionId} moved the render with crust/${gateId} at its default, so this proves nothing`
        ).toBe(0);
    });

    it('declares each gate as a two-position control the engine reads as a boolean', () => {
        for (const { gateId } of GATES) {
            const parameter = getPluginById('crust')?.parameters.find((candidate) => candidate.id === gateId);
            expect(parameter, `crust/${gateId} is not in the plugin registry`).toBeDefined();
            if (!parameter) {
                continue;
            }

            expect([parameter.minValue, parameter.maxValue]).toEqual([0, 1]);
            expect(parameter.type).toBe('int');
            expect(parameter.automatable).toBe(true);

            // The engine reads `value > 0.5`, so the delivery law has to hand it
            // one of the two positions and never a value between them — an
            // automation ride crosses the middle on every pass.
            expect(quantiseDeviceParameterValue({ deviceType: 'crust', paramId: gateId, value: 0.4 })).toBe(0);
            expect(quantiseDeviceParameterValue({ deviceType: 'crust', paramId: gateId, value: 0.6 })).toBe(1);
        }
    });

    it('defaults each gate to the value the engine already holds', () => {
        // `addDevice` seeds `parameterValues` from these defaults and pushes
        // every one to the engine, so a default that disagreed with
        // `CrustEngine::new` would change how an existing project sounds the
        // moment the declaration landed.
        const engineDefaults: Record<string, number> = { attackAuto: 1, releaseAuto: 1, satEnabled: 0 };

        for (const { gateId } of GATES) {
            const parameter = getPluginById('crust')?.parameters.find((candidate) => candidate.id === gateId);
            expect(parameter?.defaultValue, `crust/${gateId} is not declared`).toBe(engineDefaults[gateId]);
        }
    });
});
