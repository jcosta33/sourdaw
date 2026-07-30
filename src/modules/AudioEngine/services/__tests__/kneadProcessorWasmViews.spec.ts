import { describe, it, expect, vi, beforeEach } from 'vitest';

// End-to-end proof, at the AudioWorkletProcessor level, that Knead maps its output
// views over the post-grow buffer when a WASM memory.grow() detaches the backing
// buffer *inside* inst.process() (audit RT-7). Knead's output views were built
// from a buffer reference captured BEFORE process(); after a mid-call grow that
// reference is detached, so constructing `new Float32Array(detached, ptr, frames)`
// faults into passthrough (silence) instead of emitting the shifted samples.
//
// The worklet globals and daw_dsp.js module are shimmed the same way the sibling
// processor specs do, except the fake memory holds a *mutable* buffer so growth
// can be simulated mid-call. No transport SAB is provided, so the shift resolves
// to zero and the view lifecycle is isolated.

const registry = new Map<string, new (...args: unknown[]) => KneadProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type KneadProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => KneadProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

// --- Growable WASM memory mock --------------------------------------------
const HEAP_BYTES = 64 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 2048;
const OUT_LEFT_PTR = 4096;
const OUT_RIGHT_PTR = 8192;

const memory: { buffer: ArrayBuffer } = { buffer: new ArrayBuffer(HEAP_BYTES) };

// When set, the next mocked inst.process() grows WASM memory mid-call.
let growOnNextProcess = false;

const FRAMES = 128;
const GROWN_OUT_LEFT_BASE = 700;
const GROWN_OUT_RIGHT_BASE = 300;

const RealFloat32Array = globalThis.Float32Array;

// Simulate a Rust allocation that grows the linear memory *inside* process():
// detach the current buffer, install a fresh one, and seed the output windows of
// the NEW buffer with recognizable ramps. A processor that maps its output views
// over the post-grow buffer reads these ramps; one that reuses the pre-call buffer
// reference throws on the detached buffer and faults into passthrough (silence).
function seedGrownBuffer(): void {
    const grown = memory.buffer.transfer(HEAP_BYTES);
    memory.buffer = grown;
    const seededLeft = new RealFloat32Array(grown, OUT_LEFT_PTR, FRAMES);
    const seededRight = new RealFloat32Array(grown, OUT_RIGHT_PTR, FRAMES);
    for (let frame = 0; frame < FRAMES; frame++) {
        seededLeft[frame] = GROWN_OUT_LEFT_BASE + frame;
        seededRight[frame] = GROWN_OUT_RIGHT_BASE + frame;
    }
}

class KneadInstanceMock {
    set_shift_semitones(): void {}
    get_input_left_ptr(): number {
        return IN_LEFT_PTR;
    }
    get_input_right_ptr(): number {
        return IN_RIGHT_PTR;
    }
    process(_frames: number): number {
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
    KneadInstance: KneadInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<KneadProcessorLike> {
    await import('../kneadProcessor');
    const Ctor = registry.get('knead-processor');
    if (!Ctor) {
        throw new Error('knead-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: KneadProcessorLike, data: unknown): void {
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

describe('KneadProcessor WASM-view lifecycle (audit RT-7)', () => {
    beforeEach(() => {
        memory.buffer = new ArrayBuffer(HEAP_BYTES);
        growOnNextProcess = false;
    });

    it('maps output views over the new buffer when memory.grow() happens inside process() (mid-block)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        // Warm up so the output views are cached over the pre-grow buffer.
        const warmup = makeBlock((_channel, frame) => frame);
        proc.process([warmup.input], [warmup.output]);

        // Arm the mock: the NEXT inst.process() grows the linear memory mid-block,
        // detaching the buffer captured before the call, and seeds the output windows
        // of the new buffer. Only a processor that maps its output views over the
        // live post-call buffer reads these ramps; one that reuses the pre-call
        // reference throws on the detached buffer and faults into passthrough.
        growOnNextProcess = true;
        const block = makeBlock((_channel, frame) => 500 + frame);
        proc.process([block.input], [block.output]);

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        const expectedLeft = Array.from({ length: FRAMES }, (_unused, frame) => GROWN_OUT_LEFT_BASE + frame);
        const expectedRight = Array.from({ length: FRAMES }, (_unused, frame) => GROWN_OUT_RIGHT_BASE + frame);
        const out0 = Array.from(block.output[0]!);
        // Neither the passthrough of the input block nor a zeroed/detached read —
        // the exact ramps the mock wrote into the grown buffer.
        expect(out0).not.toEqual(Array.from(block.input[0]!));
        expect(out0).toEqual(expectedLeft);
        expect(Array.from(block.output[1]!)).toEqual(expectedRight);
    });
});
