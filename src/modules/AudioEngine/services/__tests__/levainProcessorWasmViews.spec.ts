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

// Levain WASM-view lifecycle (audit RT-1 / RT-7): two output views revalidated
// against a post-process() re-read of the live buffer (sample-instrument synth —
// no audio inputs).

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<LevainProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const GROWN_LEFT_BASE = 1120;
const GROWN_RIGHT_BASE = 720;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
    ]);
}

class LevainInstanceMock {
    note_on(): void {}
    note_off(): void {}
    all_notes_off(): void {}
    all_sounds_off(): void {}
    set_param(): void {}
    handle_cc(): void {}
    lifecycle_state(): number {
        return 0;
    }
    advance_silence(): void {}
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
    LevainInstance: LevainInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function loadProcessor(): Promise<LevainProcessorLike> {
    await import('../levainProcessor');
    const Ctor = registry.get('levain-processor');
    if (!Ctor) {
        throw new Error('levain-processor was not registered');
    }
    return new Ctor();
}

function send(proc: LevainProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const output = makeChannels(2, FRAMES);
    return { inputs: [], outputs: [output] };
}

describe('LevainProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view across steady-state process() blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

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
