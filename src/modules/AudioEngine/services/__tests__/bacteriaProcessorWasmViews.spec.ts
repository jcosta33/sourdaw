import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createGrowableMemory,
    createViewCounter,
    growAndSeedRamps,
    installWorkletGlobals,
    makeChannels,
    measureWasmViewAllocations,
    ramp,
    RealFloat32Array,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// Bacteria WASM-view lifecycle (audit RT-1 / RT-7): input L/R, output L/R, and the
// 6-element band-levels telemetry view. Every view read after process() (outputs
// AND band-levels) must map the post-grow buffer, so this spec exercises the
// metering path (every 8th block) across a mid-process grow.

type BacteriaProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<BacteriaProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 2048;
const OUT_LEFT_PTR = 4096;
const OUT_RIGHT_PTR = 6144;
const BAND_LEVELS_PTR = 8192;
const BAND_COUNT = 6;
const FRAMES = 128;
const GROWN_LEFT_BASE = 1010;
const GROWN_RIGHT_BASE = 610;
const GROWN_BAND_BASE = 40;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
        { ptr: BAND_LEVELS_PTR, length: BAND_COUNT, base: GROWN_BAND_BASE },
    ]);
}

class BacteriaInstanceMock {
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
    get_band_levels_ptr(): number {
        return BAND_LEVELS_PTR;
    }
    get_input_db(): number {
        return 0;
    }
    get_output_db(): number {
        return 0;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    BacteriaInstance: BacteriaInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<BacteriaProcessorLike> {
    await import('../bacteriaProcessor');
    const Ctor = registry.get('bacteria-processor');
    if (!Ctor) {
        throw new Error('bacteria-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: BacteriaProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const input = makeChannels(2, FRAMES, (_channel, frame) => frame);
    const output = makeChannels(2, FRAMES);
    return { inputs: [input], outputs: [output] };
}

// Fresh 32-float telemetry SAB slot; index 3.. holds the band-levels blit.
function makeSab(): { sab: SharedArrayBuffer; view: Float32Array } {
    const sab = new SharedArrayBuffer(RealFloat32Array.BYTES_PER_ELEMENT * 32);
    return { sab, view: new RealFloat32Array(sab, 0, 32) };
}

describe('BacteriaProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view (inputs, outputs, band-levels) across steady-state blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const { sab } = makeSab();
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });

        // Warm up 8 blocks so the metering branch (every 8th block) has already
        // built the band-levels view before measurement begins.
        for (let block = 0; block < 8; block++) {
            const { inputs, outputs } = makeBlock();
            proc.process(inputs, outputs);
        }

        const counter = createViewCounter(memory);
        const allocations = measureWasmViewAllocations(counter, () => {
            for (let block = 0; block < 16; block++) {
                const { inputs, outputs } = makeBlock();
                proc.process(inputs, outputs);
            }
        });

        expect(allocations).toBe(0);
    });

    it('remaps output AND band-levels views over the new buffer when memory.grow() happens inside a metering block', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const { sab, view } = makeSab();
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });

        // Seven warm-up blocks (no metering yet); the 8th block both grows the
        // memory mid-process and triggers the metering branch, so the output views
        // and the band-levels view must all map the post-grow buffer.
        for (let block = 0; block < 7; block++) {
            const { inputs, outputs } = makeBlock();
            proc.process(inputs, outputs);
        }

        growOnNextProcess = true;
        const { inputs, outputs } = makeBlock();
        proc.process(inputs, outputs);

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        const out0 = Array.from(outputs[0]![0]!);
        expect(out0.some((sample) => Number.isNaN(sample))).toBe(false);
        expect(out0).toEqual(ramp(FRAMES, GROWN_LEFT_BASE));
        expect(Array.from(outputs[0]![1]!)).toEqual(ramp(FRAMES, GROWN_RIGHT_BASE));
        // Band-levels blitted from the grown buffer into SAB indices 3..8.
        const bandBlit = Array.from(view.subarray(3, 3 + BAND_COUNT));
        expect(bandBlit).toEqual(ramp(BAND_COUNT, GROWN_BAND_BASE));
    });
});
