import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createGrowableMemory,
    createViewCounter,
    growAndSeedRamps,
    installWorkletGlobals,
    makeChannels,
    measureWasmViewAllocations,
    ramp,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// Gluten WASM-view lifecycle (audit RT-1 / RT-7): six WASM-memory views — main
// L/R inputs, sidechain L/R inputs, and L/R outputs. The input and sidechain
// views are written before process(); the output views are revalidated against a
// post-process() re-read of the live buffer so a mid-call grow maps the new one.

type GlutenProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<GlutenProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 2048;
const SC_LEFT_PTR = 4096;
const SC_RIGHT_PTR = 6144;
const OUT_LEFT_PTR = 8192;
const OUT_RIGHT_PTR = 10240;
const FRAMES = 128;
const GROWN_LEFT_BASE = 920;
const GROWN_RIGHT_BASE = 520;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
    ]);
}

class GlutenInstanceMock {
    set_param(): void {}
    get_latency_samples(): number {
        return 0;
    }
    get_input_left_ptr(): number {
        return IN_LEFT_PTR;
    }
    get_input_right_ptr(): number {
        return IN_RIGHT_PTR;
    }
    get_sc_left_ptr(): number {
        return SC_LEFT_PTR;
    }
    get_sc_right_ptr(): number {
        return SC_RIGHT_PTR;
    }
    process(): number {
        if (growOnNextProcess) {
            growOnNextProcess = false;
            seedGrownBuffer();
        }
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    GlutenInstance: GlutenInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<GlutenProcessorLike> {
    await import('../glutenProcessor');
    const Ctor = registry.get('gluten-processor');
    if (!Ctor) {
        throw new Error('gluten-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: GlutenProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

// Main stereo input in inputs[0], sidechain stereo input in inputs[1] — exercises
// the sidechain view path alongside the main input/output views.
function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const main = makeChannels(2, FRAMES, (_channel, frame) => frame);
    const sidechain = makeChannels(2, FRAMES, (_channel, frame) => frame * 0.5);
    const output = makeChannels(2, FRAMES);
    return { inputs: [main, sidechain], outputs: [output] };
}

describe('GlutenProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view (inputs, sidechain, outputs) across steady-state blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const warmup = makeBlock();
        proc.process(warmup.inputs, warmup.outputs);

        const counter = createViewCounter(memory);
        const allocations = measureWasmViewAllocations(counter, () => {
            for (let block = 0; block < 16; block++) {
                const { inputs, outputs } = makeBlock();
                proc.process(inputs, outputs);
            }
        });

        expect(allocations).toBe(0);
    });

    it('maps output views over the new buffer when memory.grow() happens inside process()', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const warmup = makeBlock();
        proc.process(warmup.inputs, warmup.outputs);

        growOnNextProcess = true;
        const { inputs, outputs } = makeBlock();
        proc.process(inputs, outputs);

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        const out0 = Array.from(outputs[0]![0]!);
        expect(out0.some((sample) => Number.isNaN(sample))).toBe(false);
        expect(out0).toEqual(ramp(FRAMES, GROWN_LEFT_BASE));
        expect(Array.from(outputs[0]![1]!)).toEqual(ramp(FRAMES, GROWN_RIGHT_BASE));
    });
});
