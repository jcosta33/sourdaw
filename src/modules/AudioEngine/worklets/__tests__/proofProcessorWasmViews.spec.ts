import { describe, it, expect, vi, beforeEach } from 'vitest';

// End-to-end proof, at the AudioWorkletProcessor level, that the RT-1/RT-7 fix
// holds inside a real processor `process()` loop (Proof is the exemplar — four
// WASM-memory views: two inputs, two outputs):
//   (a) steady-state blocks allocate no Float32Array over WASM memory, and
//   (b) after a simulated memory.grow() (buffer detached + replaced) the views
//       are rebuilt and read correct bytes from the new buffer without faulting.
//
// The worklet globals and the daw_dsp.js WASM module are shimmed off-thread the
// same way the sibling processor specs do it, except the fake memory here holds a
// *mutable* buffer so growth can be simulated.

const registry = new Map<string, new (...args: unknown[]) => ProofProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type ProofProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => ProofProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

// --- Growable WASM memory mock --------------------------------------------
const HEAP_BYTES = 64 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 2048;
const OUT_LEFT_PTR = 0; // process() returns this — output left mirrors input left
const OUT_RIGHT_PTR = 4096;

const memory: { buffer: ArrayBuffer } = { buffer: new ArrayBuffer(HEAP_BYTES) };

// When set, the next mocked inst.process() grows WASM memory mid-call.
let growOnNextProcess = false;

// Count only Float32Array constructions that map WASM memory (arg0 === the live
// heap buffer). Input/output scratch arrays (length form) and the SAB telemetry
// view (different buffer) are deliberately excluded.
let wasmViewConstructions = 0;
const RealFloat32Array = globalThis.Float32Array;
class CountingFloat32Array extends RealFloat32Array {
    constructor(bufferOrLength: ArrayBuffer | number, byteOffset?: number, length?: number) {
        if (typeof bufferOrLength === 'number') {
            super(bufferOrLength);
            return;
        }
        super(bufferOrLength, byteOffset, length);
        if (bufferOrLength === memory.buffer) {
            wasmViewConstructions++;
        }
    }
}

class ProofInstanceMock {
    process(): number {
        if (growOnNextProcess) {
            growOnNextProcess = false;
            seedGrownBuffer();
        }
        return OUT_LEFT_PTR;
    }
    get_input_left_ptr(): number {
        return IN_LEFT_PTR;
    }
    get_input_right_ptr(): number {
        return IN_RIGHT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
    get_latency_samples(): number {
        return 0;
    }
    // Meter getters — value content is irrelevant to the view invariant.
    get_input_lufs(): number {
        return 0;
    }
    get_output_lufs(): number {
        return 0;
    }
    get_output_st_lufs(): number {
        return 0;
    }
    get_integrated_lufs(): number {
        return 0;
    }
    get_true_peak_db(): number {
        return 0;
    }
    get_lra(): number {
        return 0;
    }
    get_correlation(): number {
        return 0;
    }
    get_limiter_gr_db(): number {
        return 0;
    }
    get_dynamics_gr(): number {
        return 0;
    }
    get_tap_peak_l(): number {
        return 0;
    }
    get_tap_peak_r(): number {
        return 0;
    }
    set_param(): void {}
    reorder(): void {}
    reset_integrated(): void {}
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    ProofInstance: ProofInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
const FRAMES = 128;
const GROWN_OUT_LEFT_BASE = 900;

// Simulate a Rust allocation that grows the linear memory *inside* a process()
// call: detach the current buffer, install a fresh one, and seed the output-left
// window of the NEW buffer with a recognizable ramp. A processor that maps its
// output view over the post-grow buffer reads this ramp; one that reuses a
// pre-call buffer reference reads a detached, zero-length view instead.
function seedGrownBuffer(): void {
    const grown = memory.buffer.transfer(HEAP_BYTES);
    memory.buffer = grown;
    const seededLeft = new RealFloat32Array(grown, OUT_LEFT_PTR, FRAMES);
    for (let frame = 0; frame < FRAMES; frame++) {
        seededLeft[frame] = GROWN_OUT_LEFT_BASE + frame;
    }
}

async function loadProcessor(): Promise<ProofProcessorLike> {
    await import('../proofProcessor');
    const Ctor = registry.get('proof-processor');
    if (!Ctor) {
        throw new Error('proof-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ProofProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeBlock(fill: (channel: number, frame: number) => number): {
    input: Float32Array[];
    output: Float32Array[];
} {
    const input = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    for (let frame = 0; frame < FRAMES; frame++) {
        input[0]![frame] = fill(0, frame);
        input[1]![frame] = fill(1, frame);
    }
    const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    return { input, output };
}

describe('ProofProcessor WASM-view lifecycle (audit RT-1 / RT-7)', () => {
    beforeEach(() => {
        memory.buffer = new ArrayBuffer(HEAP_BYTES);
        wasmViewConstructions = 0;
        growOnNextProcess = false;
    });

    it('allocates no WASM-memory view across steady-state process() blocks once warmed up', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        // Warm-up block builds the four cached views (allowed to allocate once).
        const warmup = makeBlock((_channel, frame) => frame / FRAMES);
        proc.process([warmup.input], [warmup.output]);

        // Now count: the steady state must not mint a single Float32Array over the
        // heap. A regression to `new Float32Array(mem, ptr, frames)` per block would
        // register 4 per block.
        vi.stubGlobal('Float32Array', CountingFloat32Array);
        wasmViewConstructions = 0;
        try {
            for (let block = 0; block < 16; block++) {
                const { input, output } = makeBlock((_channel, frame) => frame / FRAMES);
                proc.process([input], [output]);
            }
        } finally {
            vi.stubGlobal('Float32Array', RealFloat32Array);
        }

        expect(wasmViewConstructions).toBe(0);
    });

    it('reuses the same backing buffer and produces correct output while the buffer is stable', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        for (let block = 0; block < 4; block++) {
            const { input, output } = makeBlock((channel, frame) => channel * 1000 + frame + block);
            proc.process([input], [output]);

            // Output left mirrors input left (process() returns OUT_LEFT_PTR ===
            // IN_LEFT_PTR): the cached views read/write the live heap correctly.
            expect(Array.from(output[0]!)).toEqual(Array.from(input[0]!));
        }
        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('rebuilds views over the new buffer after memory.grow() and reads correct bytes without faulting', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        // Build the cached views over the original buffer.
        const first = makeBlock((_channel, frame) => frame);
        proc.process([first.input], [first.output]);

        // Grow: detach the original buffer and install a fresh one, exactly like a
        // WASM memory.grow(). The processor's cached views now point at a detached
        // buffer — steady-state code that did not revalidate would throw on .set().
        const originalBuffer = memory.buffer;
        memory.buffer = originalBuffer.transfer(HEAP_BYTES);
        expect(originalBuffer.detached).toBe(true);

        // Seed a recognizable pattern into the NEW buffer at the output-right window
        // so a correct rebuilt view reads it back verbatim.
        const seededRight = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, FRAMES);
        for (let frame = 0; frame < FRAMES; frame++) {
            seededRight[frame] = 7 + frame;
        }

        const second = makeBlock((_channel, frame) => 500 + frame);
        proc.process([second.input], [second.output]);

        // No fault posted — the processor rebuilt rather than reading a detached view.
        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        // Output left mirrors the new input written into the new buffer at IN_LEFT_PTR.
        expect(Array.from(second.output[0]!)).toEqual(Array.from(second.input[0]!));
        // Output right reads the seeded pattern from the new buffer — proof the view
        // maps the grown buffer at the correct offset, not stale/detached memory.
        expect(Array.from(second.output[1]!)).toEqual(Array.from(seededRight));
    });

    it('rebuilds output views when memory.grow() happens inside process() (mid-block) and emits the new buffer samples', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        // Warm up so the output views are cached over the pre-grow buffer.
        const warmup = makeBlock((_channel, frame) => frame);
        proc.process([warmup.input], [warmup.output]);

        // Arm the mock: the NEXT inst.process() grows the linear memory mid-block,
        // detaching the buffer the inputs were just written into, and seeds the
        // output-left window of the new buffer. Only a processor that re-reads the
        // live buffer AFTER process() maps the grown buffer here; one that captured
        // the buffer before the call reads a detached, zero-length view and emits
        // stale silence.
        growOnNextProcess = true;
        const block = makeBlock((_channel, frame) => 500 + frame);
        proc.process([block.input], [block.output]);

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        // Output left is exactly the ramp the mock wrote into the grown buffer —
        // proof the output view maps the post-grow buffer, not the detached one.
        const expected = Array.from({ length: FRAMES }, (_unused, frame) => GROWN_OUT_LEFT_BASE + frame);
        expect(Array.from(block.output[0]!)).toEqual(expected);
    });
});
