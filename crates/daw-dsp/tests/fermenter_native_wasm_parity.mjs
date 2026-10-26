import { readFileSync } from 'node:fs';

import { FermenterInstance, initSync } from '../../../src/modules/AudioEngine/wasm/daw_dsp.js';

const FRAMES_PER_BLOCK = 128;
const BLOCKS = 40;
const FRAMES = FRAMES_PER_BLOCK * BLOCKS;
const SENTINEL = 'FERMENTER_NATIVE_WASM_PARITY_JSON:';

const wasmBytes = readFileSync(new URL('../../../public/wasm/daw-dsp/daw_dsp_bg.wasm', import.meta.url));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });
const instance = new FermenterInstance(48_000, 8);

try {
    // Match the native fixture's f32 parameters and block-boundary MIDI events.
    for (const [name, value] of [
        ['engine', 0],
        ['osc_waveform', 0],
        ['osc_level', 0.75],
        ['layer_pan', -0.5],
        ['amp_attack', 0.001],
        ['amp_decay', 0.125],
        ['amp_sustain', 0.5],
        ['amp_release', 0.02],
        ['master_gain', 0.5],
        ['noise_level', 0],
        ['drift', 0],
        ['chaos_amount', 0],
    ]) {
        instance.set_param(name, value);
    }

    const left = [];
    const right = [];
    for (let block = 0; block < BLOCKS; block++) {
        switch (block) {
            case 0:
                instance.note_on(60, 100);
                break;
            case 16:
                instance.note_off(60);
                break;
            case 20:
                instance.note_on(67, 80);
                break;
            case 28:
                instance.note_off(67);
                break;
        }
        const leftPtr = instance.process(FRAMES_PER_BLOCK);
        const rightPtr = instance.get_right_ptr();
        // Copy before the next WASM call can grow memory or overwrite the buffers.
        left.push(...new Float32Array(wasm.memory.buffer, leftPtr, FRAMES_PER_BLOCK));
        right.push(...new Float32Array(wasm.memory.buffer, rightPtr, FRAMES_PER_BLOCK));
    }

    const nanFlushCount = instance.get_nan_flush_count();
    if (nanFlushCount !== 0) {
        throw new Error(`WASM Fermenter scrubbed ${nanFlushCount} non-finite samples`);
    }
    if (
        left.length !== FRAMES ||
        right.length !== FRAMES ||
        !left.every(Number.isFinite) ||
        !right.every(Number.isFinite)
    ) {
        throw new Error('WASM Fermenter must render two finite channels of 5120 frames');
    }
    console.log(`${SENTINEL}${JSON.stringify({ framesPerChannel: FRAMES, left, right, nanFlushCount })}`);
} finally {
    instance.free();
}
