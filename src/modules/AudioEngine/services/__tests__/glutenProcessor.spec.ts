import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createGlutenRuntimeParameterIds } from '../../models/GlutenRuntimeControl';

import {
    RealFloat32Array,
    installWorkletGlobals,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// GlutenProcessor message handling (param latency-change reporting, init guards,
// SAB metering) and process() guard/passthrough/fault paths. The existing
// glutenProcessorWasmViews spec covers only the RT-1/RT-7 WASM-view growth.

type GlutenProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<GlutenProcessorLike>();

const HEAP_BYTES = 128 * 1024;
const IN_LEFT_PTR = 0;
const IN_RIGHT_PTR = 1024;
const SC_LEFT_PTR = 2048;
const SC_RIGHT_PTR = 3072;
const OUT_LEFT_PTR = 4096;
const OUT_RIGHT_PTR = 5120;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const paramCalls: Array<{ name: string; value: number }> = [];
const processCalls: number[] = [];
let nextLatency = 0; // controllable so the latency-change branch can fire
let processShouldThrow = false;
// When non-null, initSync throws this value (covers String(error) + the
// error-after-ready arm of the onmessage catch).
let initShouldThrow: unknown = null;

class GlutenInstanceMock {
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }
    get_input_left_ptr(): number {
        return IN_LEFT_PTR;
    }
    get_input_right_ptr(): number {
        return IN_RIGHT_PTR;
    }
    get_sc_left_ptr(): number {
        return SC_LEFT_PTR;
    }
    get_sc_right_ptr(): number {
        return SC_RIGHT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
    process(frames: number): number {
        processCalls.push(frames);
        if (processShouldThrow) {
            throw new Error('wasm trap');
        }
        // Copy main input into the output windows so process() reads it back.
        const inLeft = new RealFloat32Array(memory.buffer, IN_LEFT_PTR, frames);
        const outLeft = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const outRight = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        outLeft.set(inLeft);
        outRight.set(inLeft); // duplicate left to right
        return OUT_LEFT_PTR;
    }
    get_latency_samples(): number {
        return nextLatency;
    }
    get_gr_db(): number {
        return -3;
    }
    get_input_db(): number {
        return -12;
    }
    get_output_db(): number {
        return -10;
    }
    get_crest(): number {
        return 6;
    }
    get_phase_corr(): number {
        return 0.9;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => {
        if (initShouldThrow !== null) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throws a non-Error value to exercise the String(error) catch arm
            throw initShouldThrow;
        }
        return { memory };
    }),
    GlutenInstance: GlutenInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<GlutenProcessorLike> {
    await import('../glutenProcessor');
    const Ctor = registry.get('gluten-processor');
    if (!Ctor) {
        throw new Error('gluten-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: GlutenProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function initializeControl(proc: GlutenProcessorLike): void {
    send(proc, {
        schemaVersion: 1,
        command: 'initialize-fallback-control',
        target: {
            trackId: 'track-1',
            deviceId: 'gluten-1',
            deviceType: 'gluten',
            parameterIds: createGlutenRuntimeParameterIds(),
        },
        correlation: { workletGeneration: 1 },
    });
}

function control(parameterId: string, value: number, controlSequence: number): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: {
            trackId: 'track-1',
            deviceId: 'gluten-1',
            deviceType: 'gluten',
            parameterId,
        },
        value,
        correlation: { workletGeneration: 1, controlSequence },
        scheduling: { targetFrame: null, deadlineFrame: null },
    };
}

function stereo(frames: number, fill: number): Float32Array[] {
    return [new Float32Array(frames).fill(fill), new Float32Array(frames).fill(fill)];
}

function resetRecording(): void {
    paramCalls.length = 0;
    processCalls.length = 0;
    nextLatency = 0;
    processShouldThrow = false;
    initShouldThrow = null;
}

describe('GlutenProcessor message handling', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('posts ready with latency and ignores a second init', async () => {
        const proc = await loadProcessor();
        nextLatency = 64;
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const ready = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
        expect((ready[0]![0] as { latency: number }).latency).toBe(64);
    });

    it('rejects the legacy raw parameter message before it reaches WASM', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        initializeControl(proc);
        paramCalls.length = 0;

        send(proc, { type: 'param', name: 'threshold', value: -12 });

        expect(paramCalls).toEqual([]);
    });

    it('reports an init error when WASM instantiation throws', async () => {
        const proc = await loadProcessor();
        initShouldThrow = new Error('WASM instantiation failed');
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('maps known params and reports a latency-changed event when latency shifts', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();

        // First get_latency_samples() returns 0; bump to 32 before the second call
        // so the post-set_param comparison detects a change.
        nextLatency = 0;
        let latencyBumpCount = 0;
        const orig = GlutenInstanceMock.prototype.get_latency_samples;
        GlutenInstanceMock.prototype.get_latency_samples = function (): number {
            latencyBumpCount++;
            // 1st call (oldLatency) → 0; 2nd call (newLatency) → 32 ⇒ change detected.
            return latencyBumpCount === 1 ? 0 : 32;
        };
        try {
            initializeControl(proc);
            send(proc, control('lookahead', 5, 1));
        } finally {
            GlutenInstanceMock.prototype.get_latency_samples = orig;
        }

        expect(paramCalls).toContainEqual({ name: 'lookahead', value: 5 });
        const changed = proc.port.postMessage.mock.calls
            .map((c) => c[0] as { type?: string; latency?: number })
            .find((m) => m.type === 'latency-changed');
        expect(changed).toBeDefined();
        expect(changed!.latency).toBe(32);
    });

    it('does not report latency-changed when the param leaves latency unchanged', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        // nextLatency stays 0 for both calls ⇒ no change.
        initializeControl(proc);
        send(proc, control('ratio', 4, 1));
        const changed = proc.port.postMessage.mock.calls
            .map((c) => c[0] as { type?: string })
            .find((m) => m.type === 'latency-changed');
        expect(changed).toBeUndefined();
    });

    it('rejects an unknown parameter name', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        initializeControl(proc);
        send(proc, control('futureKnob', 9, 1));
        expect(paramCalls).toEqual([]);
    });

    it('ignores param messages before init (no instance)', async () => {
        const proc = await loadProcessor();
        initializeControl(proc);
        send(proc, control('ratio', 4, 1));
        expect(paramCalls).toEqual([]);
    });

    // ── onmessage catch arms (glutenProcessor.ts:109, 112) ───────────────────

    it('reports String(error) when init throws a non-Error value', async () => {
        initShouldThrow = 'gluten-boom';
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const errorMsg = proc.port.postMessage.mock.calls.find((c) => (c[0] as { type?: string }).type === 'error');
        expect(errorMsg).toBeDefined();
        expect((errorMsg![0] as { message: string }).message).toBe('gluten-boom');
    });

    it('posts an error and stops taking work when set_param throws while already ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        initializeControl(proc);
        resetRecording();
        proc.port.postMessage.mockClear();

        const spy = vi.spyOn(GlutenInstanceMock.prototype, 'set_param').mockImplementation(() => {
            throw new Error('param trap while ready');
        });
        send(proc, control('ratio', 4, 1));
        spy.mockRestore();

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('param trap while ready');

        // A throw here may mean the instance is trapped, so it stops being fed.
        send(proc, control('ratio', 8, 2));
        expect(paramCalls).toEqual([]);
    });
});

describe('GlutenProcessor process paths', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        resetRecording();
    });

    it('returns early (no processing) when not ready', async () => {
        const proc = await loadProcessor();
        proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        expect(processCalls).toEqual([]);
    });

    it('returns early when main input or output has fewer than 2 channels', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // mono main input
        proc.process([[new Float32Array(FRAMES).fill(0.5)]], [stereo(FRAMES, 0)]);
        expect(processCalls).toEqual([]);

        // mono output
        proc.process([stereo(FRAMES, 0.5)], [[new Float32Array(FRAMES)]]);
        expect(processCalls).toEqual([]);
    });

    it('copies main input to output and processes a sidechain input when present', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        const main = stereo(FRAMES, 0.4);
        const sidechain = stereo(FRAMES, 0.2);
        const output = stereo(FRAMES, 0);
        proc.process([main, sidechain], [output]);

        expect(processCalls).toEqual([FRAMES]);
        // instance copied main-left into both output channels.
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.4, 6);
        }
    });

    it('processes without a sidechain input (sc branch skipped)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.6)], [output]);
        expect(processCalls).toEqual([FRAMES]);
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.6, 6);
        }
    });

    it('clears the sidechain buffers when a connected input disappears', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        proc.process([stereo(FRAMES, 0.4), stereo(FRAMES, 0.7)], [stereo(FRAMES, 0)]);
        const scLeft = new RealFloat32Array(memory.buffer, SC_LEFT_PTR, FRAMES);
        const scRight = new RealFloat32Array(memory.buffer, SC_RIGHT_PTR, FRAMES);
        expect(scLeft[0]).toBeCloseTo(0.7, 6);
        expect(scRight[0]).toBeCloseTo(0.7, 6);

        proc.process([stereo(FRAMES, 0.4)], [stereo(FRAMES, 0)]);

        const silence = Array.from({ length: FRAMES }, () => 0);
        expect([...scLeft]).toEqual(silence);
        expect([...scRight]).toEqual(silence);
    });

    it('writes meter telemetry into the SAB every 8 rendered blocks', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 32);
        const view = new Float32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        resetRecording();

        const render = (): void => {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        };

        for (let i = 0; i < 7; i++) {
            render();
        }
        expect(view[0]).toBe(0); // gate not tripped yet
        render(); // 8th ⇒ trip
        expect(view[0]).toBe(-3); // get_gr_db()
        expect(view[1]).toBe(-12); // get_input_db()
        expect(view[5]).toBe(0); // get_latency_samples()
    });

    it('does not throw when no SAB was initialised', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        for (let i = 0; i < 9; i++) {
            proc.process([stereo(FRAMES, 0.5)], [stereo(FRAMES, 0)]);
        }
        expect(true).toBe(true);
    });

    it('faults and passthrough-copies when instance.process throws, then stops processing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;

        const output = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.3)], [output]);

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        // Fault path ran passthrough after the trap.
        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.3, 6);
        }

        processCalls.length = 0;
        processShouldThrow = false;
        proc.process([stereo(FRAMES, 0.3)], [stereo(FRAMES, 0)]);
        expect(processCalls).toEqual([]); // faulted ⇒ short-circuit
    });

    // ── process() input guards and channel fallbacks ─────────────────────────

    it('returns early when the first main input channel is missing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        const out = stereo(FRAMES, 0);
        // input[0] is nullish ⇒ `!in0` true arm (line 151).
        proc.process([[null as unknown as Float32Array, new Float32Array(FRAMES)]], [out]);
        expect(processCalls).toEqual([]);
        // Output untouched.
        expect(out[0]![0]).toBe(0);
    });

    it('feeds the left channel into the right input slot when the right is absent (main path)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // 2-channel input with a hole at index 1 ⇒ `input[1] ?? in0` (line 166).
        const out = stereo(FRAMES, 0);
        proc.process([[new Float32Array(FRAMES).fill(0.5), undefined as unknown as Float32Array]], [out]);
        // process() ran without throwing and copied left→both outputs.
        expect(processCalls).toEqual([FRAMES]);
        for (const sample of out[0]!) {
            expect(sample).toBeCloseTo(0.5, 6);
        }
    });

    it('skips the sidechain copy when the sidechain first channel is empty, and falls back for a mono sidechain', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();

        // Sidechain present but first channel zero-length ⇒ sc0.length > 0 false.
        const outA = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.4), [new Float32Array(0)]], [outA]);
        expect(processCalls).toEqual([FRAMES]);

        // Sidechain present with a single (mono) channel ⇒ `scInput[1] ?? sc0`.
        processCalls.length = 0;
        const outB = stereo(FRAMES, 0);
        proc.process([stereo(FRAMES, 0.4), [new Float32Array(FRAMES).fill(0.2)]], [outB]);
        expect(processCalls).toEqual([FRAMES]);
    });

    it('passthrough falls back to the left channel for the right output when the right input is absent (fault path)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        resetRecording();
        processShouldThrow = true;

        // 2-channel input with a hole at index 1 ⇒ _passthrough `input[1] ?? in0`.
        const in0 = new Float32Array(FRAMES).fill(0.8);
        const out = stereo(FRAMES, 0);
        proc.process([[in0, undefined as unknown as Float32Array]], [out]);

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        // Left copied to both outputs via the ?? fallback in _passthrough.
        for (const sample of out[0]!) {
            expect(sample).toBeCloseTo(0.8, 6);
        }
        for (const sample of out[1]!) {
            expect(sample).toBeCloseTo(0.8, 6);
        }
    });
});
