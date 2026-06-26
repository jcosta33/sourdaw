import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
// The processor module runs in AudioWorklet global scope, which provides
// AudioWorkletProcessor, registerProcessor and `sampleRate`. Provide them so
// the real module can be imported and self-register.
const registry = new Map<string, new () => AudioWorkletProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type AudioWorkletProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    // RT-safe cached WASM-memory views, asserted for reuse across render quanta.
    _wasmInL: Float32Array | null;
    _wasmInR: Float32Array | null;
    _wasmOutL: Float32Array | null;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => AudioWorkletProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);

// --- WASM module mock ------------------------------------------------------
// Captures every shift handed to the WASM instance so the test can assert the
// value the worklet computed for a given transport + blob state.
const shiftCalls: number[] = [];
const WASM_HEAP = new ArrayBuffer(1024);

class KneadInstanceMock {
    set_shift_semitones(value: number): void {
        shiftCalls.push(value);
    }
    get_input_left_ptr(): number {
        return 0;
    }
    get_input_right_ptr(): number {
        return 256;
    }
    process(): number {
        return 512;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
    KneadInstance: KneadInstanceMock,
}));

// The processor compiles `new WebAssembly.Module(wasmBytes)` before handing the
// module to the (mocked) initSync, so the bytes must be a structurally valid
// module — the 8-byte magic + version header is the minimal one that compiles.
const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

// Transport SAB layout mirrored from kneadProcessor.ts.
const TRANSPORT_BEAT_F64 = 0;
const TRANSPORT_TEMPO_F64 = 1;
const TRANSPORT_IS_PLAYING_F64 = 5;

function makePlayingTransport(beat: number, tempo: number): SharedArrayBuffer {
    // 16 f64 slots is comfortably past Int32 seq index 14 (bytes 56-60).
    const sab = new SharedArrayBuffer(16 * 8);
    const f64 = new Float64Array(sab);
    f64[TRANSPORT_BEAT_F64] = beat;
    f64[TRANSPORT_TEMPO_F64] = tempo;
    f64[TRANSPORT_IS_PLAYING_F64] = 1; // playing
    // Seq counter (Int32 index 14) is left at 0 (even, unchanged) so the
    // seqlock read succeeds on the first attempt.
    return sab;
}

async function loadProcessor(): Promise<AudioWorkletProcessorLike> {
    await import('../kneadProcessor');
    const Ctor = registry.get('knead-processor');
    if (!Ctor) {
        throw new Error('knead-processor was not registered');
    }
    return new Ctor();
}

function sendMessage(proc: AudioWorkletProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

describe('KneadProcessor pitch-shift computation', () => {
    beforeEach(() => {
        shiftCalls.length = 0;
    });

    it('feeds a finite shift to the WASM instance when both pitch centers are present', async () => {
        const proc = await loadProcessor();
        const transportSAB = makePlayingTransport(2, 120);
        sendMessage(proc, { type: 'init', wasmBytes: MINIMAL_WASM, transportSAB });

        sendMessage(proc, {
            type: 'update-state',
            clips: {
                c1: {
                    startBeat: 0,
                    endBeat: 4,
                    blobs: [
                        {
                            startTime: 0,
                            endTime: 10,
                            pitchCenterCents: 6200,
                            originalPitchCenterCents: 6000,
                        },
                    ],
                },
            },
        });

        const input = [new Float32Array(128)];
        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([input], [output]);

        // (6200 - 6000) / 100 == 2 semitones.
        expect(shiftCalls.at(-1)).toBe(2);
    });

    it('does not produce a NaN shift when originalPitchCenterCents is missing after a project reload', async () => {
        const proc = await loadProcessor();

        const transportSAB = makePlayingTransport(2, 120);
        sendMessage(proc, { type: 'init', wasmBytes: MINIMAL_WASM, transportSAB });

        // A blob rehydrated from the persisted (narrow) schema has no
        // originalPitchCenterCents — exactly the post-CRDT-round-trip shape.
        sendMessage(proc, {
            type: 'update-state',
            clips: {
                c1: {
                    startBeat: 0,
                    endBeat: 4,
                    blobs: [
                        {
                            startTime: 0,
                            endTime: 10,
                            pitchCenterCents: 6200,
                            // originalPitchCenterCents intentionally absent
                        },
                    ],
                },
            },
        });

        const input = [new Float32Array(128)];
        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([input], [output]);

        const lastShift = shiftCalls.at(-1);
        expect(lastShift).not.toBeNaN();
        // Missing original is treated as the current center → zero shift.
        expect(lastShift).toBe(0);
    });

    it('reuses the WASM-memory typed-array views across render quanta (no per-block allocation)', async () => {
        const proc = await loadProcessor();
        const transportSAB = makePlayingTransport(2, 120);
        sendMessage(proc, { type: 'init', wasmBytes: MINIMAL_WASM, transportSAB });
        sendMessage(proc, {
            type: 'update-state',
            clips: {
                c1: {
                    startBeat: 0,
                    endBeat: 4,
                    blobs: [{ startTime: 0, endTime: 10, pitchCenterCents: 6200, originalPitchCenterCents: 6000 }],
                },
            },
        });

        const input = [new Float32Array(128), new Float32Array(128)];
        const output = [new Float32Array(128), new Float32Array(128)];

        // First render quantum builds the views.
        proc.process([input], [output]);
        const firstInL = proc._wasmInL;
        const firstInR = proc._wasmInR;
        const firstOutL = proc._wasmOutL;
        expect(firstInL).toBeInstanceOf(Float32Array);
        expect(firstInR).toBeInstanceOf(Float32Array);
        expect(firstOutL).toBeInstanceOf(Float32Array);

        // Subsequent quanta with the same buffer/ptrs/frames must reuse the very
        // same view objects — a fresh Float32Array here would be a per-block alloc.
        proc.process([input], [output]);
        proc.process([input], [output]);
        expect(proc._wasmInL).toBe(firstInL);
        expect(proc._wasmInR).toBe(firstInR);
        expect(proc._wasmOutL).toBe(firstOutL);
    });
});
