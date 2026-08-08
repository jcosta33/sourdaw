import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import grinderAudioParamContract from '../../services/grinderAudioParamContract.json';
import { initSync, GrinderInstance } from '../daw_dsp.js';

/**
 * Welds the two independently-computed halves of the Grinder automation SAB
 * layout against the **shipped** binary.
 *
 * `grinderProcessor.ts` writes a flat `f32` region — a header of one value-count
 * per automatable parameter, then one `MAX_GRINDER_BLOCK_SIZE` block of values
 * per parameter, the value region starting at *the number of automatable
 * parameters*. Rust reads it back with the identical formula, deriving its own
 * base from `GRINDER_AUTOMATABLE_PARAM_CONTRACT.len()`
 * (`crates/daw-dsp/src/grinder/{params,engine}.rs`). Neither language checks the
 * other, and the TS view is *smaller* than Rust's `Vec`, so a disagreement stays
 * in bounds and is silently wrong rather than trapping.
 *
 * The TS base was a literal `11`. Nothing red if a twelfth contract entry moved
 * Rust's base to 12 — the existing specs read the mock buffer through the same
 * literal, so both sides of every assertion moved together. This spec removes
 * that freedom: the layout is computed here from the contract exactly as
 * production computes it, and the verdict comes from the real engine.
 *
 * The population is the contract file itself, never a list in this spec, so a
 * twelfth entry is exercised the moment it is added — and until the matching
 * Rust entry ships in a rebuilt `daw_dsp_bg.wasm`, *every* row reds, because a
 * one-slot base disagreement misaligns all of them at once.
 */

const FRAMES = 128;
const BLOCKS = 24;
const MAX_GRINDER_BLOCK_SIZE = 2048;

/**
 * The contract is a JSON **array**, so ordinals are dense `0..n-1` by
 * construction — there is no sparse-table hazard here and no separate density
 * pin is needed, unlike the `Record`-shaped ordinal maps the other devices use.
 * `length` is therefore both the parameter count and the value-region base.
 */
const AUTOMATABLE_PARAM_COUNT = grinderAudioParamContract.length;
const VALUE_REGION_BASE = AUTOMATABLE_PARAM_COUNT;

const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

function writeInputBlock(instance: GrinderInstance, block: number): void {
    const left = new Float32Array(wasm.memory.buffer, instance.get_input_left_ptr(), FRAMES);
    const right = new Float32Array(wasm.memory.buffer, instance.get_input_right_ptr(), FRAMES);
    for (let frame = 0; frame < FRAMES; frame++) {
        const sample = 0.5 * Math.sin((2 * Math.PI * 220 * (block * FRAMES + frame)) / 48_000);
        left[frame] = sample;
        right[frame] = sample;
    }
}

function absorbBlock(instance: GrinderInstance, leftBase: number): number {
    const left = new Float32Array(wasm.memory.buffer, leftBase, FRAMES);
    const right = new Float32Array(wasm.memory.buffer, instance.get_right_ptr(), FRAMES);
    let energy = 0;
    for (let frame = 0; frame < FRAMES; frame++) {
        energy += Math.abs(left[frame] ?? 0) + Math.abs(right[frame] ?? 0);
    }
    return energy;
}

/**
 * The engine's own by-name path. `GrinderEngine::set_param` routes any
 * automatable name straight into `set_automatable_param(index, value)` — the
 * exact function the automation buffer feeds — so this is the reference the
 * buffer-driven render has to reproduce bit for bit.
 */
function renderByName(name: string, value: number): number {
    const instance = new GrinderInstance(48_000);
    try {
        instance.set_param(name, value);
        let energy = 0;
        for (let block = 0; block < BLOCKS; block++) {
            writeInputBlock(instance, block);
            energy += absorbBlock(instance, instance.process(FRAMES));
        }
        return energy;
    } finally {
        instance.free();
    }
}

/** The production layout, recomputed here from the contract, driven per block. */
function renderByAutomationSlot(paramIndex: number, value: number, valueRegionBase: number): number {
    const instance = new GrinderInstance(48_000);
    try {
        let energy = 0;
        for (let block = 0; block < BLOCKS; block++) {
            // Re-derive the pointer every block: `process_automated` may grow
            // wasm memory and detach any view held across the call.
            const automationPtr = instance.get_automation_values_ptr();
            const valueCountSlot = new Float32Array(wasm.memory.buffer, automationPtr + paramIndex * 4, 1);
            valueCountSlot[0] = 1;
            const valueIndex = valueRegionBase + paramIndex * MAX_GRINDER_BLOCK_SIZE;
            const valueSlot = new Float32Array(wasm.memory.buffer, automationPtr + valueIndex * 4, 1);
            valueSlot[0] = value;
            writeInputBlock(instance, block);
            energy += absorbBlock(instance, instance.process_automated(FRAMES));
        }
        return energy;
    } finally {
        instance.free();
    }
}

describe('checked-in Grinder WASM automation buffer layout', () => {
    it('delivers every contract parameter through the derived layout, identically to the engine’s by-name path', () => {
        const viaBuffer: Record<string, number> = {};
        const viaName: Record<string, number> = {};
        const atMinimum: Record<string, number> = {};

        for (const [index, descriptor] of grinderAudioParamContract.entries()) {
            const { name, minValue, maxValue } = descriptor;
            viaBuffer[name] = renderByAutomationSlot(index, maxValue, VALUE_REGION_BASE);
            viaName[name] = renderByName(name, maxValue);
            atMinimum[name] = renderByName(name, minValue);
        }

        // Ordinal + base agreement, as one equality over the whole contract.
        // Driving ordinal `index` through the buffer must land on the same
        // parameter, with the same value, as driving `contract[index].name`
        // through the engine's string path — which resolves the index through
        // Rust's own hand-written `get_automatable_param_index` match, so a
        // transposition between that match and the contract array reds here too.
        expect(viaBuffer).toEqual(viaName);

        // ...and the probes actually move the engine, so the equality above
        // cannot be satisfied by both arms rendering the same default. Each
        // parameter's maximum must render differently from its minimum.
        for (const { name } of grinderAudioParamContract) {
            expect(viaName[name]).not.toBe(atMinimum[name]);
        }
    });

    it('reads the value region at the contract-derived base and nowhere else', () => {
        // The regression's signature, stated as behaviour rather than as a
        // number. A base one slot off does not throw and does not render
        // garbage — the value lands where Rust never looks, Rust reads the
        // untouched `0.0` beside it, `clamp` accepts it, and the parameter
        // silently collapses to its minimum. That is why the literal `11` could
        // have survived a twelfth contract entry with every existing spec green.
        const [firstParam] = grinderAudioParamContract;
        if (!firstParam) {
            throw new Error('the Grinder AudioParam contract must not be empty');
        }

        const drivenAtDerivedBase = renderByAutomationSlot(0, firstParam.maxValue, VALUE_REGION_BASE);
        const drivenOneSlotHigh = renderByAutomationSlot(0, firstParam.maxValue, VALUE_REGION_BASE + 1);
        const drivenOneSlotLow = renderByAutomationSlot(0, firstParam.maxValue, VALUE_REGION_BASE - 1);

        expect(drivenAtDerivedBase).toBe(renderByName(firstParam.name, firstParam.maxValue));
        expect(drivenOneSlotHigh).toBe(renderByName(firstParam.name, 0));
        expect(drivenOneSlotLow).not.toBe(drivenAtDerivedBase);
    });
});
