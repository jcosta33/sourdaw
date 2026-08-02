import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createGrowableMemory,
    createTotalViewCounter,
    installWorkletGlobals,
    makeChannels,
    measureAllocations,
    RealFloat32Array,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// Fermenter telemetry publish path (audit RT-3).
//
// Before the fix, the ~46 ms telemetry branch inside `process()` did two things
// forbidden on the render thread: it allocated `new Float32Array(128)` for the
// scope waveform, and it shipped that buffer to the main thread with
// `this.port.postMessage(..., [scopeBuffer.buffer])` — a structured-clone /
// transfer enqueue on the audio thread. Both are replaced by plain stores into
// an already-mapped SAB view, bracketed by the shared seqlock.

type FermenterProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<FermenterProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;

// Must mirror engine/telemetryAllocator.ts FERMENTER_IDX / FERMENTER_SLOT_FLOATS
// and the literals pinned in fermenterProcessor.ts.
const SLOT_FLOATS = 160;
const PEAK_L_IDX = 0;
const PEAK_R_IDX = 1;
const SEQ_IDX = 31;
const SCOPE_BASE = 32;
const SCOPE_SAMPLES = 128;
const TELEMETRY_PERIOD_FRAMES = 2048;

const memory = createGrowableMemory(HEAP_BYTES);

/** Seed the left/right output windows so telemetry has recognizable content. */
function seedOutputs(leftAt: (index: number) => number, rightAt: (index: number) => number): void {
    const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, FRAMES);
    const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, FRAMES);
    for (let index = 0; index < FRAMES; index++) {
        left[index] = leftAt(index);
        right[index] = rightAt(index);
    }
}

class FermenterInstanceMock {
    note_on(): void {}
    note_off(): void {}
    set_param(): void {}
    set_param_by_id(): void {}
    process(): number {
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    FermenterInstance: FermenterInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<FermenterProcessorLike> {
    await import('../fermenterProcessor');
    const Ctor = registry.get('fermenter-processor');
    if (!Ctor) {
        throw new Error('fermenter-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: FermenterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(): { inputs: Float32Array[][]; outputs: Float32Array[][] } {
    return { inputs: [], outputs: [makeChannels(2, FRAMES)] };
}

/** Boot a processor with WASM + a telemetry slot, returning the slot views. */
async function bootWithSlot(): Promise<{
    proc: FermenterProcessorLike;
    view: Float32Array;
    seqView: Int32Array;
}> {
    const proc = await loadProcessor();
    const sab = new ArrayBuffer(SLOT_FLOATS * 4);
    send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
    send(proc, { type: 'init-sab', sab, byteOffset: 0 });
    return { proc, view: new RealFloat32Array(sab, 0, SLOT_FLOATS), seqView: new Int32Array(sab, 0, SLOT_FLOATS) };
}

/** Run `blocks` render quanta, advancing `currentFrame` by a full block each time. */
function renderBlocks(proc: FermenterProcessorLike, blocks: number, startFrame = 0): void {
    for (let block = 0; block < blocks; block++) {
        vi.stubGlobal('currentFrame', startFrame + block * FRAMES);
        const { inputs, outputs } = makeBlock();
        proc.process(inputs, outputs);
    }
}

describe('FermenterProcessor telemetry publish (audit RT-3)', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        vi.stubGlobal('currentFrame', 0);
    });

    it('sends no port message across a full telemetry cadence of render quanta', async () => {
        const { proc } = await bootWithSlot();
        seedOutputs(
            (index) => index / FRAMES,
            (index) => -index / FRAMES
        );
        proc.port.postMessage.mockClear();

        // 32 blocks = 4096 frames = two full publish periods, so the telemetry
        // branch runs twice inside the measured window.
        renderBlocks(proc, 32);

        expect(proc.port.postMessage).not.toHaveBeenCalled();
    });

    it('allocates no Float32Array — of any form — across those same quanta', async () => {
        const { proc } = await bootWithSlot();
        seedOutputs(
            (index) => index / FRAMES,
            () => 0
        );

        // Warm the cached WASM views before measuring, so the count reflects
        // steady state rather than first-block setup.
        renderBlocks(proc, 1);

        const counter = createTotalViewCounter();
        const allocations = measureAllocations(counter, () => {
            renderBlocks(proc, 32, FRAMES);
        });

        // Unlike the RT-1/RT-7 counter this one also sees length-form scratch
        // arrays, which is precisely what the old `new Float32Array(128)` scope
        // buffer was.
        expect(allocations).toBe(0);
    });

    it('publishes peaks and the scope waveform into the slot at the ~46 ms cadence', async () => {
        const { proc, view } = await bootWithSlot();
        // Left ramps 0 → 127 (peak 127); right is a constant −0.5 (peak 0.5).
        seedOutputs(
            (index) => index,
            () => -0.5
        );

        renderBlocks(proc, 1);

        expect(view[PEAK_L_IDX]).toBe(FRAMES - 1);
        expect(view[PEAK_R_IDX]).toBe(0.5);
        // frames/128 === 1 here, so the waveform is the left output verbatim.
        expect(Array.from(view.subarray(SCOPE_BASE, SCOPE_BASE + SCOPE_SAMPLES))).toEqual(
            Array.from({ length: SCOPE_SAMPLES }, (_unused, index) => index)
        );
    });

    it('brackets each publish with an even→odd→even seqlock generation', async () => {
        const { proc, seqView } = await bootWithSlot();
        seedOutputs(
            () => 0.25,
            () => 0.25
        );

        expect(Atomics.load(seqView, SEQ_IDX)).toBe(0);

        renderBlocks(proc, 1);
        const afterFirst = Atomics.load(seqView, SEQ_IDX);
        // Two bumps per publish: odd while writing, back to even when settled.
        expect(afterFirst).toBe(2);
        expect(afterFirst % 2).toBe(0);

        // Advance one full period so the branch fires exactly once more.
        renderBlocks(proc, 1, TELEMETRY_PERIOD_FRAMES);
        expect(Atomics.load(seqView, SEQ_IDX)).toBe(4);
    });

    it('publishes once per period, not once per render quantum', async () => {
        const { proc, seqView } = await bootWithSlot();
        seedOutputs(
            () => 0.5,
            () => 0.5
        );

        // 16 blocks = 2048 frames = exactly one period.
        renderBlocks(proc, 16);

        expect(Atomics.load(seqView, SEQ_IDX)).toBe(2);
    });

    it('renders audio and stays unfaulted when no telemetry slot was supplied', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        seedOutputs(
            (index) => index / FRAMES,
            (index) => index / FRAMES
        );
        proc.port.postMessage.mockClear();

        const { inputs, outputs } = makeBlock();
        proc.process(inputs, outputs);

        // No SAB (no cross-origin isolation) must not fault the device: audio
        // still reaches the output, only the meters go dark.
        expect(proc.port.postMessage).not.toHaveBeenCalled();
        expect(Array.from(outputs[0]![0]!)).toEqual(
            Array.from({ length: FRAMES }, (_unused, index) => Math.fround(index / FRAMES))
        );
    });
});
