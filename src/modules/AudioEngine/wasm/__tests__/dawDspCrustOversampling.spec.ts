/**
 * Crust's oversampling control, measured against the engine that answers it.
 *
 * `crust/oversampling` declares a range (1..32) and, within it, the settings
 * the control offers as distinct. The range is a claim about how far a write
 * may travel; the distinct settings are a claim about which of those writes
 * the DSP can tell apart. Only the engine can settle the second one, so this
 * renders every integer in the declared range through the checked-in wasm
 * rather than reasoning about `normalize_factor` in TypeScript.
 *
 * The declared settings are read from the shipped registry: the `legalSet`
 * when the parameter declares one, otherwise every integer in the range —
 * which is exactly what the generic Inspector knob offers for an `int`
 * parameter (`deriveStep` → 1). Before the legal set was declared, that made
 * this file red with the measurement that motivated the change: 32 offered
 * positions, 6 distinct renders, grouped `1 | 2,3 | 4..7 | 8..15 | 16..31 | 32`.
 *
 * The saturator is the stage the factor feeds (`CrustEngine::set_param`
 * "oversampling" → `Saturator::set_oversampling`), and it short-circuits the
 * whole oversampling round trip while idle (`Saturator::is_idle` — disabled
 * or zero mix). So the fixture drives the two values that matter: `sat_enabled`
 * from its default 0 to 1 and `sat_mix` from its default 0 to 100. At the
 * defaults, every factor renders identically and this file would agree with
 * any declaration at all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getPluginById, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

const FRAMES = 512;
const BLOCKS = 8;
const SAMPLE_RATE = 48_000;
/** High enough that the saturator's harmonics land above Nyquist unless the
 * cascade moves them, which is what makes one factor sound unlike another. */
const PROBE_HZ = 7_000;

import { initSync, CrustInstance } from '../daw_dsp.js';

const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

function renderAtFactor(factor: number): Float32Array {
    const crust = new CrustInstance(SAMPLE_RATE);
    try {
        crust.set_param('sat_enabled', 1);
        crust.set_param('sat_algorithm', 1);
        crust.set_param('sat_drive', 12);
        crust.set_param('sat_mix', 100);
        crust.set_param('gain', 6);
        crust.set_param('oversampling', factor);

        const inputLeftPtr = crust.get_input_left_ptr();
        const inputRightPtr = crust.get_input_right_ptr();
        const rendered = new Float32Array(FRAMES * BLOCKS);
        let sampleIndex = 0;

        for (let block = 0; block < BLOCKS; block++) {
            // Re-viewed each block: a wasm `memory.grow()` detaches the buffer.
            const inputLeft = new Float32Array(wasm.memory.buffer, inputLeftPtr, FRAMES);
            const inputRight = new Float32Array(wasm.memory.buffer, inputRightPtr, FRAMES);
            for (let frame = 0; frame < FRAMES; frame++) {
                const sample = 0.9 * Math.sin((2 * Math.PI * PROBE_HZ * sampleIndex) / SAMPLE_RATE);
                inputLeft[frame] = sample;
                inputRight[frame] = sample;
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

function rendersIdentically(left: Float32Array, right: Float32Array): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index++) {
        if (!Object.is(left[index], right[index])) {
            return false;
        }
    }
    return true;
}

type DeclaredOversampling = {
    minValue: number;
    maxValue: number;
    /** What the control offers as distinct settings. */
    declaredSettings: number[];
    legalValues: readonly number[] | undefined;
};

function declaredOversamplingParameter(): DeclaredOversampling {
    // From the registry production reads, never a fixture: the point of the
    // file is that the shipped declaration matches the shipped engine.
    const parameter = getPluginById('crust')?.parameters.find((candidate) => candidate.id === 'oversampling');
    if (!parameter) {
        throw new Error('crust/oversampling is not in the plugin registry');
    }
    if (parameter.legalSet) {
        return {
            minValue: parameter.minValue,
            maxValue: parameter.maxValue,
            declaredSettings: [...parameter.legalSet.values],
            legalValues: parameter.legalSet.values,
        };
    }
    // No declared legal set means "every integer in the range is its own
    // setting" — the contract the generic Inspector knob offers for an `int`.
    const everyInteger: number[] = [];
    for (let value = parameter.minValue; value <= parameter.maxValue; value++) {
        everyInteger.push(value);
    }
    return {
        minValue: parameter.minValue,
        maxValue: parameter.maxValue,
        declaredSettings: everyInteger,
        legalValues: undefined,
    };
}

describe('checked-in Crust WASM oversampling', () => {
    it('declares exactly the factors the engine renders differently', () => {
        const { minValue, maxValue, declaredSettings } = declaredOversamplingParameter();

        // Group every integer in the declared range by what the engine
        // actually renders. Each group's smallest member is the factor the
        // engine resolved the whole group onto, because the cascade floors.
        const classes: Array<{ representative: number; rendered: Float32Array }> = [];
        for (let value = minValue; value <= maxValue; value++) {
            const rendered = renderAtFactor(value);
            const existing = classes.find((candidate) => rendersIdentically(candidate.rendered, rendered));
            if (existing) {
                continue;
            }
            classes.push({ representative: value, rendered });
        }

        // The fixture is capable of telling factors apart — with the saturator
        // idle (its default), every factor renders identically and the sweep
        // would find a single class no declaration could match.
        expect(classes.length).toBeGreaterThan(1);

        // Every declared setting is a setting of its own, and there is no
        // extra setting hiding between two declared ones.
        expect(classes.map((entry) => entry.representative)).toEqual(declaredSettings);
    });

    it('delivers the factor the engine was going to use, for every value in the declared range', () => {
        const { minValue, maxValue, legalValues } = declaredOversamplingParameter();
        expect(legalValues, 'crust/oversampling declares no legal set').toBeDefined();
        if (!legalValues) {
            return;
        }

        const renderedByFactor = new Map<number, Float32Array>();
        for (const legal of legalValues) {
            renderedByFactor.set(legal, renderAtFactor(legal));
        }

        // A stored value between two members is reachable — a learned MIDI CC
        // scales 0..127 across the declared span and persists what it lands
        // on, and a project saved before the set was declared could hold any
        // integer in the range. What the delivery law delivers has to be what
        // the engine would have resolved that value to on its own, or
        // correcting the declaration would have changed how an existing
        // project renders. Integers only: the law rounds before it resolves,
        // so a fraction is never what the engine is asked about.
        for (let value = minValue; value <= maxValue; value++) {
            const delivered = quantiseDeviceParameterValue({
                deviceType: 'crust',
                paramId: 'oversampling',
                value,
            });
            const deliveredRender = renderedByFactor.get(delivered);
            expect(deliveredRender, `${value} was delivered as ${delivered}, not a declared factor`).toBeDefined();
            expect(
                rendersIdentically(renderAtFactor(value), deliveredRender!),
                `crust rendered ${value} unlike the ${delivered} the delivery law hands it`
            ).toBe(true);
        }
    });

    it('renders a fractional automation value as the factor the rounding law delivers', () => {
        // The one place the delivery law is not a mirror of the engine, and it
        // has to be checked as its own claim rather than folded into the sweep
        // above. `quantiseDeviceParameterValue` rounds before it resolves, so
        // 15.6 delivers 16 — which is what a ride across 15.6 has rendered
        // since the rounding law landed. Handing the raw 15.6 to the engine
        // would render 8, because Rust truncates (`value.max(1.0) as usize`);
        // that is the audible difference this ordering avoids.
        const delivered = quantiseDeviceParameterValue({ deviceType: 'crust', paramId: 'oversampling', value: 15.6 });
        expect(delivered).toBe(16);

        expect(
            rendersIdentically(renderAtFactor(delivered), renderAtFactor(16)),
            'the delivered factor did not render as 16x'
        ).toBe(true);
        expect(
            rendersIdentically(renderAtFactor(15.6), renderAtFactor(8)),
            'the engine no longer truncates a raw fraction, so this ordering guards nothing'
        ).toBe(true);
    });
});
