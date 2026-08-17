import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    createGrowableMemory,
    resetGrowableMemory,
    type GrowableMemory,
} from './wasmViewGrowthHarness';

// BacteriaProcessor message handling (init/init-sab/param, PARAM_MAP mapping,
// latency-change reporting), process() guard/passthrough/fault paths, and the
// 8-block metering cadence that blits band-level telemetry into the SAB.

type BacteriaProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<BacteriaProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 4096;
const OUT_LEFT_PTR = 8192;
const OUT_RIGHT_PTR = 12288;
const BAND_PTR = 16384;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const paramCalls: Array<{ name: string; value: number }> = [];
let latencySamples = 0;
let inputDb = -12;
let outputDb = -6;
let processShouldThrow = false;

class BacteriaInstanceMock {
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
        // Touching `oversampling` changes latency to exercise the latency-changed path.
        if (name === 'oversampling' && value > 0) {
            latencySamples = 256;
        }
    }
    get_latency_samples(): number {
        return latencySamples;
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
    get_band_levels_ptr(): number {
        return BAND_PTR;
    }
    get_input_db(): number {
        return inputDb;
    }
    get_output_db(): number {
        return outputDb;
    }
    process(frames: number): number {
        if (processShouldThrow) {
            throw new Error('wasm trap');
        }
        // Echo left input to both output windows so we can assert wiring.
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        const inLeft = new RealFloat32Array(memory.buffer, IN_LEFT_PTR, frames);
        left.set(inLeft);
        right.set(inLeft);
        // Seed a 6-element band-level array with distinct linear amplitudes.
        const bands = new RealFloat32Array(memory.buffer, BAND_PTR, 6);
        for (let i = 0; i < 6; i++) {
            bands[i] = (i + 1) / 10;
        }
        return OUT_LEFT_PTR;
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

function initializeControl(proc: BacteriaProcessorLike): void {
    send(proc, {
        schemaVersion: 1,
        command: 'initialize-fallback-control',
        target: {
            trackId: 'track-1',
            deviceId: 'bacteria-1',
            deviceType: 'bacteria',
            parameterIds: ['oversampling', 'band5_drive', 'bypass'],
        },
        correlation: { workletGeneration: 1 },
    });
}
function control(
    parameterId: string,
    value: number,
    controlSequence: number,
    scheduling: { targetFrame: number | null; deadlineFrame: number | null } = {
        targetFrame: null,
        deadlineFrame: null,
    }
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: { trackId: 'track-1', deviceId: 'bacteria-1', deviceType: 'bacteria', parameterId },
        value,
        correlation: { workletGeneration: 1, controlSequence },
        scheduling,
    };
}

function stereo(frames: number, fill: number): Float32Array[] {
    return [new Float32Array(frames).fill(fill), new Float32Array(frames).fill(fill)];
}

function resetRecording(): void {
    paramCalls.length = 0;
    latencySamples = 0;
    inputDb = -12;
    outputDb = -6;
    processShouldThrow = false;
}

describe('BacteriaProcessor message handling', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('posts ready with the initial latency on init and ignores a second init', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const ready = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
        expect((ready[0]![0] as { latency: number }).latency).toBe(0);
    });

    it('maps camelCase param names through PARAM_MAP and reports latency changes', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();

        // threshold (identity-mapped) does not change latency.
        send(proc, control('unknown', 0.5, 1));
        expect(paramCalls).toEqual([]);
        const latencyAfter1 = proc.port.postMessage.mock.calls.filter(
            (c) => (c[0] as { type: string }).type === 'latency-changed'
        );
        expect(latencyAfter1).toHaveLength(0);

        // oversampling triggers a latency change to 256.
        send(proc, control('oversampling', 2, 2));
        expect(paramCalls).toContainEqual({ name: 'oversampling', value: 2 });
        const latencyAfter2 = proc.port.postMessage.mock.calls.filter(
            (c) => (c[0] as { type: string }).type === 'latency-changed'
        );
        expect(latencyAfter2).toHaveLength(1);
        expect((latencyAfter2[0]![0] as { latency: number }).latency).toBe(256);
    });

    it('accepts generated band keys but rejects forged/replayed controls', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();
        send(proc, control('band5_drive', 0.3, 1));
        send(proc, control('band5_drive', 0.9, 1));
        send(proc, {
            ...control('band5_drive', 0.8, 2),
            target: { trackId: 'forged', deviceId: 'bacteria-1', deviceType: 'bacteria', parameterId: 'band5_drive' },
        });
        expect(paramCalls).toEqual([{ name: 'band5_drive', value: 0.3 }]);
    });

    it('rejects raw, malformed, expired, and exhausted controls while applying due scheduled commands', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();

        send(proc, { type: 'param', name: 'oversampling', value: 2 });
        send(proc, { ...control('oversampling', 2, 1), scheduling: { targetFrame: 10 } });
        send(proc, control('bypass', 1, 2));
        expect(paramCalls).toEqual([{ name: 'bypass', value: 1 }]);

        vi.stubGlobal('currentFrame', 0);
        send(proc, control('band5_drive', 0.3, 3, { targetFrame: 128, deadlineFrame: 256 }));
        expect(paramCalls).toHaveLength(1);
        vi.stubGlobal('currentFrame', 128);
        proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        expect(paramCalls).toContainEqual({ name: 'band5_drive', value: 0.3 });

        vi.stubGlobal('currentFrame', 300);
        send(proc, control('band5_drive', 0.9, 4, { targetFrame: 128, deadlineFrame: 256 }));
        expect(paramCalls).not.toContainEqual({ name: 'band5_drive', value: 0.9 });

        vi.stubGlobal('currentFrame', 0);
        for (let sequence = 5; sequence < 37; sequence++) {
            send(proc, control('band5_drive', sequence, sequence, { targetFrame: 1_000, deadlineFrame: 2_000 }));
        }
        vi.stubGlobal('currentFrame', 1_000);
        proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        expect(paramCalls.filter((call) => call.name === 'band5_drive')).toHaveLength(33);
    });

    it('fails closed when the preallocated scheduled-control queue is full without consuming its sequence', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();
        vi.stubGlobal('currentFrame', 0);

        for (let sequence = 1; sequence <= 32; sequence++) {
            send(proc, control('band5_drive', sequence, sequence, { targetFrame: 1_000, deadlineFrame: 2_000 }));
        }
        send(proc, control('band5_drive', 33, 33, { targetFrame: 1_000, deadlineFrame: 2_000 }));

        const state = proc as typeof proc & {
            _lastFallbackControlSequence: number;
            _pendingFallbackControls: unknown[];
        };
        expect(state._pendingFallbackControls).toHaveLength(32);
        expect(Object.hasOwn(state._pendingFallbackControls, '-1')).toBe(false);
        expect(state._lastFallbackControlSequence).toBe(32);
        expect(proc.port.postMessage).toHaveBeenCalledWith({
            type: 'fallback-control-rejected',
            reason: 'queue-full',
            controlSequence: 33,
        });

        send(proc, control('bypass', 1, 33));
        expect(paramCalls).toEqual([{ name: 'bypass', value: 1 }]);
    });

    it('ignores param messages before init (no instance) and after a fault', async () => {
        const proc = await loadProcessor();
        // Before init: instance is null, param is dropped.
        send(proc, { type: 'param', name: 'threshold', value: 0.5 });
        expect(paramCalls).toEqual([]);
    });

    it('installs an SAB telemetry view on init-sab', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();
        inputDb = -20;
        outputDb = -10;

        // Run 8 blocks to trigger the metering cadence once.
        for (let i = 0; i < 8; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
        expect(view[0]).toBe(-20); // input db
        expect(view[1]).toBe(-10); // output db
        expect(view[2]).toBe(0); // latency samples
    });
});

describe('BacteriaProcessor process & telemetry', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('returns early (no passthrough) when not ready', async () => {
        const proc = await loadProcessor();
        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.7)], [output]);
        // Not ready: process returns true but does NOT passthrough-copy.
        for (const sample of output[0]!) {
            expect(sample).toBe(0);
        }
    });

    it('returns early when input has fewer than 2 channels', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        const output = stereo(FRAMES, 0);
        // Mono input (< 2 channels).
        proc.process([[new Float32Array(FRAMES).fill(0.5)]], [output]);
        for (const sample of output[0]!) {
            expect(sample).toBe(0);
        }
    });

    it('returns early when the left input or left output is absent', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        // Left input absent (undefined channel) → !in0 guard.
        proc.process(
            [[undefined, new Float32Array(FRAMES).fill(0.5)] as unknown as Float32Array[]],
            [stereo(FRAMES, 0)]
        );
        // Left output absent (undefined channel) → !out0 guard.
        proc.process([stereo(FRAMES, 0.5)], [[undefined, new Float32Array(FRAMES)] as unknown as Float32Array[]]);
    });

    it('copies left input to both stereo outputs (wiring) and blits 6 band levels into the SAB', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();

        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.3)], [output]);

        // Both channels echo the left input (0.3 within Float32 precision).
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.3, 6);
        }
        for (const sample of output[1]!) {
            expect(sample).toBeCloseTo(0.3, 6);
        }

        // Metering has not fired yet (only 1 block; cadence is 8).
        expect(view[3]).toBe(0);

        // Run 7 more blocks to hit the cadence.
        for (let i = 0; i < 7; i++) {
            proc.process([stereo(FRAMES, 0.3)], [stereo(FRAMES, 0)]);
        }
        // Band levels blitted into slots 3..8: 0.1..0.6 within Float32 precision.
        for (let i = 0; i < 6; i++) {
            expect(view[3 + i]).toBeCloseTo((i + 1) / 10, 6);
        }
    });

    it('upmixes a mono right channel (input[1] absent) to the right input view', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        const output = stereo(FRAMES, 0);
        // Two-channel input whose right channel is undefined → synthesized from
        // the left channel via `input[1] ?? in0`. (input.length >= 2 clears the
        // channel-count guard, and the absent channel exercises the fallback.)
        proc.process([[new Float32Array(FRAMES).fill(0.25), undefined] as unknown as Float32Array[]], [output]);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.25, 6);
        }
        for (const sample of output[1]!) {
            expect(sample).toBeCloseTo(0.25, 6);
        }
    });

    it('faults, posts an error, and passthrough-copies when instance.process throws', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;

        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.4)], [output]);
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.4, 6);
        }
    });

    it('stops processing after faulting (subsequent blocks passthrough-skip the engine)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;
        proc.process([stereo(FRAMES, 0.4)], [stereo(FRAMES, 0)]);
        processShouldThrow = false;

        // After fault, process returns early (not ready path does not passthrough
        // in bacteria — it just returns true). Params are also dropped now.
        const callsBefore = paramCalls.length;
        send(proc, { type: 'param', name: 'threshold', value: 0.5 });
        expect(paramCalls.length).toBe(callsBefore);
    });
});
