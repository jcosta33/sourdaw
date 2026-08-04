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

// Grinder WASM-view lifecycle (audit RT-1 / RT-7): fixed-size input/output/
// automation views cached at init. Grinder revalidates via
// _refreshWasmViewsIfMemoryChanged() and — critically — re-reads the output views
// AFTER process_automated(), which can grow WASM memory inside the DSP call.

type GrinderProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

const { registry } = installWorkletGlobals<GrinderProcessorLike>();

// 2048-float (8192-byte) fixed buffers; automation buffer is 11 + 11*2048 floats.
const HEAP_BYTES = 256 * 1024;
const IN_LEFT_PTR = 8192;
const IN_RIGHT_PTR = 16384;
const OUT_LEFT_PTR = 24576;
const OUT_RIGHT_PTR = 32768;
const AUTOMATION_PTR = 40960;
const FRAMES = 128;
const GROWN_LEFT_BASE = 1340;
const GROWN_RIGHT_BASE = 940;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
    ]);
}

class GrinderInstanceMock {
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
    get_output_left_ptr(): number {
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
    get_automation_values_ptr(): number {
        return AUTOMATION_PTR;
    }
    process_automated(): boolean {
        if (growOnNextProcess) {
            growOnNextProcess = false;
            seedGrownBuffer();
        }
        return true;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    GrinderInstance: GrinderInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<GrinderProcessorLike> {
    await import('../grinderProcessor');
    const Ctor = registry.get('grinder-processor');
    if (!Ctor) {
        throw new Error('grinder-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: GrinderProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const input = makeChannels(2, FRAMES, (_channel, frame) => frame);
    const output = makeChannels(2, FRAMES);
    return { inputs: [input], outputs: [output] };
}

describe('GrinderProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view across steady-state process() blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const warmup = makeBlock();
        proc.process(warmup.inputs, warmup.outputs, {});

        const counter = createViewCounter(memory);
        const allocations = measureWasmViewAllocations(counter, () => {
            for (let block = 0; block < 16; block++) {
                const { inputs, outputs } = makeBlock();
                proc.process(inputs, outputs, {});
            }
        });

        expect(allocations).toBe(0);
    });

    it('re-reads output views over the new buffer when process_automated() grows memory (mid-call)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const warmup = makeBlock();
        proc.process(warmup.inputs, warmup.outputs, {});

        growOnNextProcess = true;
        const { inputs, outputs } = makeBlock();
        proc.process(inputs, outputs, {});

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        const out0 = Array.from(outputs[0]![0]!);
        expect(out0.some((sample) => Number.isNaN(sample))).toBe(false);
        expect(out0).toEqual(ramp(FRAMES, GROWN_LEFT_BASE));
        expect(Array.from(outputs[0]![1]!)).toEqual(ramp(FRAMES, GROWN_RIGHT_BASE));
    });
});
