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

// ProofChamber (Dutch Oven) WASM-view lifecycle (audit RT-1 / RT-7): two output
// views revalidated against a post-`process()` re-read of the live buffer.

type ProofChamberProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<ProofChamberProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const GROWN_LEFT_BASE = 810;
const GROWN_RIGHT_BASE = 410;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
    ]);
}

class ProofChamberInstanceMock {
    set_param(): void {}
    set_param_by_id(): void {}
    get_latency(): number {
        return 128;
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

vi.mock('../../wasm/proof_chamber.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    ProofChamberInstance: ProofChamberInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<ProofChamberProcessorLike> {
    await import('../proofChamberProcessor');
    const Ctor = registry.get('proof-chamber-processor');
    if (!Ctor) {
        throw new Error('proof-chamber-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ProofChamberProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const input = makeChannels(2, FRAMES, (_channel, frame) => frame);
    const output = makeChannels(2, FRAMES);
    return { inputs: [input], outputs: [output] };
}

describe('ProofChamberProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view across steady-state process() blocks once warmed up', async () => {
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
