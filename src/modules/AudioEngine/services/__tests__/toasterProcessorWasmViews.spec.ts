import { describe, it, expect, vi, beforeEach } from 'vitest';

// End-to-end proof, at the AudioWorkletProcessor level, that Toaster rebuilds its
// cached output views when a WASM memory.grow() detaches the backing buffer
// *inside* inst.process() (audit RT-7). Toaster's revalidation compares the
// cached view's buffer against a live re-read of this._memory.buffer taken AFTER
// process(); comparing it against the pre-call buffer would match the equally
// stale cache after a mid-process grow and skip the rebuild, leaving every output
// mapping detached memory (reads back NaN).
//
// The worklet globals and daw_dsp.js module are shimmed the same way the sibling
// processor specs do, except the fake memory holds a *mutable* buffer so growth
// can be simulated mid-call.

const registry = new Map<string, new () => ToasterProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type ToasterProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => ToasterProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);
vi.stubGlobal('currentFrame', 0);

// --- Growable WASM memory mock --------------------------------------------
const MAX_BLOCK = 4096;
const CHANNEL_BYTES = MAX_BLOCK * Float32Array.BYTES_PER_ELEMENT;
// Toaster lays out 1 parent output + 16 pad outputs, each a stereo pair; the
// highest channel index is 2 + 15 * 2 = 32, so the heap must span 34 channels.
const HEAP_BYTES = (2 + 16 * 2) * CHANNEL_BYTES;
const BASE_PTR = 0; // process() returns the output base; output 0 left lives here.

const memory: { buffer: ArrayBuffer } = { buffer: new ArrayBuffer(HEAP_BYTES) };

// When set, the next mocked inst.process() grows WASM memory mid-call.
let growOnNextProcess = false;

const FRAMES = 128;
const GROWN_OUT0_LEFT_BASE = 900;

const RealFloat32Array = globalThis.Float32Array;

// Simulate a Rust allocation that grows the linear memory *inside* process():
// detach the current buffer, install a fresh one, and seed output 0's left window
// of the NEW buffer with a recognizable ramp. A processor that rebuilds its views
// over the post-grow buffer reads this ramp; one that revalidates against the
// pre-call buffer skips the rebuild and reads detached (NaN) memory.
function seedGrownBuffer(): void {
    const grown = memory.buffer.transfer(HEAP_BYTES);
    memory.buffer = grown;
    const seededLeft = new RealFloat32Array(grown, BASE_PTR, FRAMES);
    for (let frame = 0; frame < FRAMES; frame++) {
        seededLeft[frame] = GROWN_OUT0_LEFT_BASE + frame;
    }
}

class ToasterInstanceMock {
    note_on(): void {}
    note_off(): void {}
    set_param(): void {}
    set_param_by_id(): void {}
    set_pad_param(): void {}
    set_pad_dry_routed(): void {}
    reset_pad_dry_routing(): void {}
    advance_silence(): void {}
    lifecycle_state(): number {
        return 0;
    }
    process(_frames: number): number {
        if (growOnNextProcess) {
            growOnNextProcess = false;
            seedGrownBuffer();
        }
        return BASE_PTR;
    }
    get_right_ptr(): number {
        return CHANNEL_BYTES;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    ToasterInstance: ToasterInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function loadProcessor(): Promise<ToasterProcessorLike> {
    await import('../toasterProcessor');
    const Ctor = registry.get('toaster-processor');
    if (!Ctor) {
        throw new Error('toaster-processor was not registered');
    }
    return new Ctor();
}

function send(proc: ToasterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function makeOutputs(): Float32Array[][] {
    return Array.from({ length: 17 }, () => [new Float32Array(FRAMES), new Float32Array(FRAMES)]);
}

describe('ToasterProcessor WASM-view lifecycle (audit RT-7)', () => {
    beforeEach(() => {
        memory.buffer = new ArrayBuffer(HEAP_BYTES);
        growOnNextProcess = false;
        vi.stubGlobal('currentFrame', 0);
    });

    it('rebuilds output views when memory.grow() happens inside process() (mid-block) and emits the new buffer samples', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

        // Warm up so the output views are cached over the pre-grow buffer.
        proc.process([[]], makeOutputs());

        // Arm the mock: the NEXT inst.process() grows the linear memory mid-block,
        // detaching the buffer the views were cached over, and seeds output 0's
        // left window of the new buffer. Only a processor that revalidates against
        // the live post-call buffer rebuilds here; one that compares the stale cache
        // against the equally stale pre-call buffer skips the rebuild and reads
        // detached (NaN) memory.
        growOnNextProcess = true;
        const outputs = makeOutputs();
        proc.process([[]], outputs);

        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        // Output 0 left is exactly the ramp the mock wrote into the grown buffer —
        // proof the rebuilt view maps the post-grow buffer, not the detached one.
        const expected = Array.from({ length: FRAMES }, (_unused, frame) => GROWN_OUT0_LEFT_BASE + frame);
        const out0Left = Array.from(outputs[0]![0]!);
        expect(out0Left.some((sample) => Number.isNaN(sample))).toBe(false);
        expect(out0Left).toEqual(expected);
    });
});
