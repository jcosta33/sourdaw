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

// Fermenter WASM-view lifecycle (audit RT-1 / RT-7): two output views revalidated
// against a post-process() re-read of the live buffer. The peak/scope telemetry
// reads the left-output view, so it too must map the post-grow buffer.
//
// Telemetry now lands in the SAB slot rather than a port message (audit RT-3),
// so the grow assertions read the slot. Whether telemetry is published at all
// (cadence, seqlock, zero allocation) is covered by
// fermenterProcessorTelemetry.spec.ts.

// Mirrors engine/telemetryAllocator.ts FERMENTER_IDX / FERMENTER_SLOT_FLOATS.
const SLOT_FLOATS = 160;
const PEAK_L_IDX = 0;
const SCOPE_BASE = 32;

type FermenterProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<FermenterProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const GROWN_LEFT_BASE = 1230;
const GROWN_RIGHT_BASE = 830;

const memory = createGrowableMemory(HEAP_BYTES);
let growOnNextProcess = false;

function seedGrownBuffer(): void {
    growAndSeedRamps(memory, HEAP_BYTES, [
        { ptr: OUT_LEFT_PTR, length: FRAMES, base: GROWN_LEFT_BASE },
        { ptr: OUT_RIGHT_PTR, length: FRAMES, base: GROWN_RIGHT_BASE },
    ]);
}

class FermenterInstanceMock {
    note_on(): void {}
    note_off(): void {}
    set_param(): void {}
    set_param_by_id(): void {}
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
    lifecycle_state(): number {
        return 0;
    }
    advance_silence(): void {}
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    FermenterInstance: FermenterInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function loadProcessor(): Promise<FermenterProcessorLike> {
    await import('../fermenterProcessor');
    const Ctor = registry.get('fermenter-processor');
    if (!Ctor) {
        throw new Error('fermenter-processor was not registered');
    }
    return new Ctor();
}

function send(proc: FermenterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    const output = makeChannels(2, FRAMES);
    return { inputs: [], outputs: [output] };
}

/** Attach a telemetry slot to `proc` and return the float view over it. */
function attachSlot(proc: FermenterProcessorLike): Float32Array {
    const sab = new ArrayBuffer(SLOT_FLOATS * 4);
    send(proc, { type: 'init-sab', sab, byteOffset: 0 });
    return new RealFloat32Array(sab, 0, SLOT_FLOATS);
}

describe('FermenterProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view across steady-state process() blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

        const warmup = makeBlock();
        proc.process(warmup.inputs, warmup.outputs);

        // This counter flags only views minted over WASM memory. That steady-state
        // process() allocates nothing at all — the stricter RT-3 invariant — is
        // asserted in fermenterProcessorTelemetry.spec.ts.
        const counter = createViewCounter(memory);
        const allocations = measureWasmViewAllocations(counter, () => {
            for (let block = 0; block < 16; block++) {
                const { inputs, outputs } = makeBlock();
                proc.process(inputs, outputs);
            }
        });

        expect(allocations).toBe(0);
    });

    it('maps output and peak/scope views over the new buffer when memory.grow() happens inside process()', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
        const slotView = attachSlot(proc);

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

        // Peak telemetry is computed from the (rebuilt) left-output view — its peak
        // is the maximum of the seeded ramp on the grown buffer, proving the scope
        // path also reads the post-grow buffer, not a detached one.
        expect(slotView[PEAK_L_IDX]).toBe(GROWN_LEFT_BASE + FRAMES - 1);
        expect(slotView[SCOPE_BASE]).toBe(GROWN_LEFT_BASE);
    });
});
