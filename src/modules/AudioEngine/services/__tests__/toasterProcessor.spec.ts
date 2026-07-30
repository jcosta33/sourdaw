import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
const registry = new Map<string, new (...args: unknown[]) => ToasterProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type ToasterProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    _queue: unknown[];
    _queueHead: number;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => ToasterProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);
vi.stubGlobal('currentFrame', 0);

// --- WASM module mock ------------------------------------------------------
const noteOffCalls: number[] = [];
const noteOnCalls: number[] = [];
const padParamCalls: Array<[number, string, number]> = [];
const padDryRoutedCalls: Array<[number, boolean]> = [];
const paramByIdCalls: Array<[number, number]> = [];
const kitParamCalls: Array<[string, number]> = [];
const processCalls: number[] = [];
const advanceSilenceCalls: number[] = [];
let padZeroDryRouted = false;
let lifecycleState = 0;
// When non-null, initSync throws this value (used to cover the String(error)
// arm and the error-after-ready arm of the onmessage catch).
let toasterInitShouldThrow: unknown = null;
const WASM_BLOCK_SAMPLES = 4096;
const WASM_CHANNEL_BYTES = WASM_BLOCK_SAMPLES * Float32Array.BYTES_PER_ELEMENT;
const WASM_HEAP = new ArrayBuffer((2 + 16 * 2) * WASM_CHANNEL_BYTES);

class ToasterInstanceMock {
    note_on(pad: number): void {
        noteOnCalls.push(pad);
        lifecycleState = 0;
    }
    note_off(pad: number): void {
        noteOffCalls.push(pad);
    }
    set_param(name: string, value: number): void {
        kitParamCalls.push([name, value]);
    }
    set_param_by_id(paramId: number, value: number): void {
        paramByIdCalls.push([paramId, value]);
    }
    set_pad_param(pad: number, name: string, value: number): void {
        padParamCalls.push([pad, name, value]);
    }
    set_pad_dry_routed(pad: number, routed: boolean): void {
        padDryRoutedCalls.push([pad, routed]);
        if (pad === 0) {
            padZeroDryRouted = routed;
        }
    }
    reset_pad_dry_routing(): void {
        padZeroDryRouted = false;
    }
    advance_silence(frames: number): void {
        advanceSilenceCalls.push(frames);
    }
    lifecycle_state(): number {
        return lifecycleState;
    }
    process(frames: number): number {
        processCalls.push(frames);
        const heap = new Float32Array(WASM_HEAP);
        heap.fill(0);
        heap.subarray(0, frames).fill(padZeroDryRouted ? 0 : 0.25);
        heap.subarray(WASM_BLOCK_SAMPLES, WASM_BLOCK_SAMPLES + frames).fill(padZeroDryRouted ? 0 : 0.5);
        heap.subarray(2 * WASM_BLOCK_SAMPLES, 2 * WASM_BLOCK_SAMPLES + frames).fill(0.75);
        heap.subarray(3 * WASM_BLOCK_SAMPLES, 3 * WASM_BLOCK_SAMPLES + frames).fill(1);
        heap.subarray(4 * WASM_BLOCK_SAMPLES, 4 * WASM_BLOCK_SAMPLES + frames).fill(-0.25);
        heap.subarray(5 * WASM_BLOCK_SAMPLES, 5 * WASM_BLOCK_SAMPLES + frames).fill(-0.5);
        return 0;
    }
    get_right_ptr(): number {
        return WASM_CHANNEL_BYTES;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => {
        if (toasterInitShouldThrow !== null) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throws a non-Error value to exercise the String(error) catch arm
            throw toasterInitShouldThrow;
        }
        return { memory: { buffer: WASM_HEAP } };
    }),
    ToasterInstance: ToasterInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<ToasterProcessorLike> {
    await import('../toasterProcessor');
    const Ctor = registry.get('toaster-processor');
    if (!Ctor) {
        throw new Error('toaster-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: ToasterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

describe('ToasterProcessor allNotesOff', () => {
    beforeEach(() => {
        noteOffCalls.length = 0;
        noteOnCalls.length = 0;
        padParamCalls.length = 0;
        padDryRoutedCalls.length = 0;
        paramByIdCalls.length = 0;
        padZeroDryRouted = false;
        processCalls.length = 0;
        advanceSilenceCalls.length = 0;
        lifecycleState = 0;
        vi.stubGlobal('currentFrame', 0);
    });

    it('evaluates numeric parameter schedules once per render quantum', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, {
            type: 'paramAutomation',
            paramId: 1,
            segments: [{ startFrame: 0, endFrame: 256, startValue: 0.2, endValue: 0.8 }],
        });
        send(proc, {
            type: 'paramAutomation',
            paramId: 3,
            segments: [{ startFrame: 0, endFrame: 256, startValue: 0, endValue: 1 }],
        });
        for (const segments of [
            [{ startFrame: 64, endFrame: 256, startValue: 0, endValue: 1 }],
            [{ startFrame: 0, endFrame: 256, startValue: Number.NaN, endValue: 1 }],
            [
                { startFrame: 0, endFrame: 64, startValue: 0, endValue: 0.5 },
                { startFrame: 65, endFrame: 256, startValue: 0.5, endValue: 1 },
            ],
        ]) {
            send(proc, { type: 'paramAutomation', paramId: 2, segments });
        }
        send(proc, {
            type: 'paramAutomation',
            paramId: 2,
            segments: [{ startFrame: 0, endFrame: 256, startValue: 0.1, endValue: 0.9 }],
        });
        send(proc, {
            type: 'paramAutomation',
            paramId: 2,
            segments: [{ startFrame: 0, endFrame: 128, startValue: 0.3, endValue: 0.7 }],
        });
        const output = [new Float32Array(8), new Float32Array(8)];

        proc.process([[]], [output]);
        vi.stubGlobal('currentFrame', 128);
        proc.process([[]], [output]);

        expect(paramByIdCalls).toEqual([
            [1, 0.2],
            [2, 0.3],
            [1, 0.5],
            [2, 0.7],
        ]);
    });

    // ── Fix 4: a single allNotesOff message releases every pad ──
    //
    // The transport's stop path used to fan out 16 note-off postMessages per
    // Toaster device. The processor now releases all 16 pads on one message.
    it('releases all 16 pads on a single allNotesOff message', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'allNotesOff' });

        expect(noteOffCalls.length).toBe(16);
        expect(noteOffCalls[0]).toBe(0);
        expect(noteOffCalls[15]).toBe(15);
        expect(new Set(noteOffCalls).size).toBe(16);
    });

    it('drops not-yet-dispatched scheduled hits so a queued noteOn cannot retrigger', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        send(proc, { type: 'noteOn', pad: 3, velocity: 100, sampleFrame: 10_000 });
        expect(proc._queue.length).toBe(1);

        send(proc, { type: 'allNotesOff' });

        expect(proc._queue.length).toBe(0);
        expect(proc._queueHead).toBe(0);

        const output = [new Float32Array(128), new Float32Array(128)];
        vi.stubGlobal('currentFrame', 20_000);
        proc.process([[]], [output]);
        expect(noteOnCalls).not.toContain(3);
        vi.stubGlobal('currentFrame', 0);
    });

    it('dispatches a scheduled hit and its locks only when the audio frame arrives', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, {
            type: 'scheduledHit',
            pad: 3,
            velocity: 100,
            sampleFrame: 10_000,
            padParams: [
                { name: 'tone', value: 0.7 },
                { name: 'engineType', value: 2 },
            ],
            restoreEngineType: 0,
        });

        expect(noteOnCalls).toEqual([]);
        expect(padParamCalls).toEqual([]);

        vi.stubGlobal('currentFrame', 9_900);
        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([[]], [output]);

        expect(noteOnCalls).toEqual([3]);
        expect(padParamCalls).toEqual([
            [3, 'tone', 0.7],
            [3, 'engine_type', 2],
            [3, 'engine_type', 0],
        ]);
        vi.stubGlobal('currentFrame', 0);
    });

    it('cancels future sequencer hits without releasing voices or deleting queued MIDI', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, {
            type: 'scheduledHit',
            pad: 5,
            velocity: 100,
            sampleFrame: 10_000,
            padParams: [],
        });
        send(proc, { type: 'noteOn', pad: 7, velocity: 90, sampleFrame: 11_000 });

        send(proc, { type: 'cancelScheduled' });

        expect(proc._queue).toEqual([{ type: 'noteOn', pad: 7, velocity: 90, sampleFrame: 11_000 }]);
        expect(noteOffCalls).toEqual([]);
    });

    it('evaluates fill conditions at the queued sample frame using the latest state', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, {
            type: 'scheduledHit',
            pad: 1,
            velocity: 100,
            sampleFrame: 1_000,
            padParams: [],
            fillCondition: 'fill',
        });
        send(proc, {
            type: 'scheduledHit',
            pad: 2,
            velocity: 100,
            sampleFrame: 1_000,
            padParams: [],
            fillCondition: 'not-fill',
        });
        send(proc, { type: 'fillState', active: true });

        vi.stubGlobal('currentFrame', 900);
        const output = [new Float32Array(128), new Float32Array(128)];
        proc.process([[]], [output]);

        expect(noteOnCalls).toEqual([1]);
        vi.stubGlobal('currentFrame', 0);
    });

    it('copies pad-pure stereo taps to outputs after the unchanged parent mix', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const outputs = Array.from({ length: 17 }, () => [new Float32Array(8), new Float32Array(8)]);

        proc.process([[]], outputs);

        expect(outputs[0]?.[0]).toEqual(new Float32Array(8).fill(0.25));
        expect(outputs[0]?.[1]).toEqual(new Float32Array(8).fill(0.5));
        expect(outputs[1]?.[0]).toEqual(new Float32Array(8).fill(0.75));
        expect(outputs[1]?.[1]).toEqual(new Float32Array(8).fill(1));
        expect(outputs[2]?.[0]).toEqual(new Float32Array(8).fill(-0.25));
        expect(outputs[2]?.[1]).toEqual(new Float32Array(8).fill(-0.5));
        expect(outputs[3]?.[0]).toEqual(new Float32Array(8));
        expect(outputs[3]?.[1]).toEqual(new Float32Array(8));
    });

    it('advances control state and hard-zeros every output without calling WASM process while asleep', async () => {
        lifecycleState = 3;
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        processCalls.length = 0;
        const outputs = Array.from({ length: 17 }, () => [new Float32Array(8).fill(1), new Float32Array(8).fill(-1)]);

        expect(proc.process([[]], outputs)).toBe(true);

        expect(processCalls).toEqual([]);
        expect(advanceSilenceCalls).toEqual([8]);
        expect(outputs.every((output) => output.every((channel) => channel.every((sample) => sample === 0)))).toBe(
            true
        );
    });

    it('dispatches a due note before the sleep check and renders the woken voice', async () => {
        lifecycleState = 3;
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        processCalls.length = 0;
        send(proc, { type: 'noteOn', pad: 4, velocity: 100, sampleFrame: 64 });
        vi.stubGlobal('currentFrame', 0);
        const output = [new Float32Array(128), new Float32Array(128)];

        proc.process([[]], [output]);

        expect(noteOnCalls).toContain(4);
        expect(processCalls).toEqual([128]);
    });

    it('publishes lifecycle transitions through the shared telemetry slot', async () => {
        lifecycleState = 3;
        const proc = await loadProcessor();
        const sab = new SharedArrayBuffer(32 * Float32Array.BYTES_PER_ELEMENT);
        const view = new Float32Array(sab);
        const seqView = new Int32Array(sab);
        send(proc, { type: 'init-sab', sab, byteOffset: 0 });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        expect(view[0]).toBe(3);
        expect(Atomics.load(seqView, 31)).toBeGreaterThan(0);

        send(proc, { type: 'noteOn', pad: 1, velocity: 100 });

        expect(view[0]).toBe(0);
        expect(Atomics.load(seqView, 31) & 1).toBe(0);
    });

    it('acknowledges disposal and terminates the processor', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const postMessage = vi.mocked(proc.port.postMessage);

        send(proc, { type: 'dispose' });

        expect(postMessage).toHaveBeenCalledWith({ type: 'disposed' });
        expect(proc.process([[]], [[new Float32Array(8), new Float32Array(8)]])).toBe(false);
    });

    it('excludes routed pad dry signal while preserving its tap and restores it on reset', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const outputs = Array.from({ length: 17 }, () => [new Float32Array(8), new Float32Array(8)]);

        send(proc, { type: 'padDryRouted', pad: 0, routed: true });
        proc.process([[]], outputs);

        expect(padDryRoutedCalls).toEqual([[0, true]]);
        expect(outputs[0]?.[0]).toEqual(new Float32Array(8));
        expect(outputs[0]?.[1]).toEqual(new Float32Array(8));
        expect(outputs[1]?.[0]).toEqual(new Float32Array(8).fill(0.75));
        expect(outputs[1]?.[1]).toEqual(new Float32Array(8).fill(1));

        send(proc, { type: 'padDryRouted', pad: 0, routed: false });
        proc.process([[]], outputs);
        expect(padDryRoutedCalls).toEqual([
            [0, true],
            [0, false],
        ]);
        expect(outputs[0]?.[0]).toEqual(new Float32Array(8).fill(0.25));
        expect(outputs[0]?.[1]).toEqual(new Float32Array(8).fill(0.5));

        send(proc, { type: 'padDryRouted', pad: 0, routed: true });
        send(proc, { type: 'resetPadDryRouting' });
        proc.process([[]], outputs);
        expect(outputs[0]?.[0]).toEqual(new Float32Array(8).fill(0.25));
    });

    it('hard-zeros an oversized render quantum without reading beyond WASM output buffers', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const outputs = Array.from({ length: 17 }, () => [
            new Float32Array(WASM_BLOCK_SAMPLES + 1).fill(Number.NaN),
            new Float32Array(WASM_BLOCK_SAMPLES + 1).fill(Number.NaN),
        ]);

        proc.process([[]], outputs);

        expect(processCalls).toEqual([0]);
        expect(outputs.every((output) => output.every((channel) => channel.every((sample) => sample === 0)))).toBe(
            true
        );
    });
});

describe('ToasterProcessor dispatch paths & process guards', () => {
    beforeEach(() => {
        kitParamCalls.length = 0;
        noteOnCalls.length = 0;
        noteOffCalls.length = 0;
        padParamCalls.length = 0;
        padDryRoutedCalls.length = 0;
        padZeroDryRouted = false;
        toasterInitShouldThrow = null;
        processCalls.length = 0;
        advanceSilenceCalls.length = 0;
        lifecycleState = 0;
        vi.stubGlobal('currentFrame', 0);
    });

    it('ignores messages before init and reports WASM instantiation errors', async () => {
        const proc = await loadProcessor();
        // Before init: every message is dropped (the ready guard).
        send(proc, { type: 'noteOn', pad: 0, velocity: 1 });
        send(proc, { type: 'param', name: 'swing', value: 0.5 });
        expect(noteOnCalls).toEqual([]);
        expect(kitParamCalls).toEqual([]);

        toasterInitShouldThrow = new Error('WASM instantiation failed');
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const postMessage = vi.mocked(proc.port.postMessage);
        const errors = postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('dispatches kit param (KIT_PARAM_MAP), pad param (PAD_PARAM_MAP), and unmapped fallbacks', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'param', name: 'swing', value: 0.6 }); // → swing
        send(proc, { type: 'param', name: 'unknownKit', value: 0.1 }); // fallback as-is
        send(proc, { type: 'padParam', pad: 2, name: 'engineType', value: 3 }); // → engine_type
        send(proc, { type: 'padParam', pad: 2, name: 'unknownPad', value: 0.4 }); // fallback as-is
        expect(kitParamCalls).toContainEqual(['swing', 0.6]);
        expect(kitParamCalls).toContainEqual(['unknownKit', 0.1]);
        expect(padParamCalls).toContainEqual([2, 'engine_type', 3]);
        expect(padParamCalls).toContainEqual([2, 'unknownPad', 0.4]);
    });

    it('dispatches immediate noteOn/noteOff (sampleFrame <= currentFrame) without queueing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        vi.stubGlobal('currentFrame', 1000);
        // sampleFrame absent → dispatched immediately (not enqueued).
        send(proc, { type: 'noteOn', pad: 4, velocity: 0.8, note: 64 });
        // sampleFrame == currentFrame → dispatched immediately (<= guard).
        send(proc, { type: 'noteOff', pad: 4, sampleFrame: 1000 });
        expect(noteOnCalls).toContain(4);
        expect(noteOffCalls).toContain(4);
    });

    it('scheduledHit with restoreEngineType omitted does not call set_pad_param a second time', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        vi.stubGlobal('currentFrame', 1000);
        send(proc, {
            type: 'scheduledHit',
            pad: 1,
            velocity: 0.9,
            sampleFrame: 1000,
            padParams: [{ name: 'volume', value: 0.5 }],
            // restoreEngineType deliberately omitted → undefined branch.
        });
        expect(noteOnCalls).toContain(1);
        expect(padParamCalls).toContainEqual([1, 'volume', 0.5]);
    });

    it('resetPadDryRouting clears all per-pad dry routing', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'padDryRouted', pad: 0, routed: true });
        expect(padZeroDryRouted).toBe(true);
        send(proc, { type: 'resetPadDryRouting' });
        expect(padZeroDryRouted).toBe(false);
    });

    it('process guards: returns early when not ready, when output < 2 channels, when out0 absent', async () => {
        const proc = await loadProcessor();
        // Not ready → returns true, no process call.
        expect(proc.process([[]], [[new Float32Array(8), new Float32Array(8)]])).toBe(true);
        expect(processCalls).toEqual([]);

        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // Parent output < 2 channels → early return.
        proc.process([[]], [[new Float32Array(8)]]);
        // out0 absent → early return (output[0] is undefined).
        proc.process([[]], [[undefined, new Float32Array(8)] as unknown as Float32Array[]]);
        // init calls process(0) once; no render process added.
        expect(processCalls).toEqual([0]);
    });

    it('automation: interpolates mid-segment and snaps to endValue at/after endFrame', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        paramByIdCalls.length = 0;
        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [
                { startFrame: 0, endFrame: 128, startValue: 0, endValue: 1 },
                { startFrame: 128, endFrame: 384, startValue: 1, endValue: 0 },
            ],
        });
        // Frame 64 → mid-segment interpolation: 0 + (1-0)*(64/128) = 0.5.
        vi.stubGlobal('currentFrame', 64);
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toContainEqual([0, 0.5]);

        // Frame 128 → at endFrame of segment 0 → endValue 1; segmentIndex advances.
        paramByIdCalls.length = 0;
        vi.stubGlobal('currentFrame', 128);
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toContainEqual([0, 1]);

        // Frame 384 → past endFrame of segment 1 → endValue 0.
        paramByIdCalls.length = 0;
        vi.stubGlobal('currentFrame', 384);
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toContainEqual([0, 0]);

        vi.stubGlobal('currentFrame', 0);
    });

    it('automation rejects malformed schedules (bad paramId, gaps, non-contiguous frames)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // paramId out of range (>= TOASTER_AUTOMATION_PARAM_COUNT=3).
        send(proc, {
            type: 'paramAutomation',
            paramId: 5,
            segments: [{ startFrame: 0, endFrame: 128, startValue: 0, endValue: 1 }],
        });
        // Non-contiguous: segment 1 startFrame (130) != previousEnd (128).
        send(proc, {
            type: 'paramAutomation',
            paramId: 0,
            segments: [
                { startFrame: 0, endFrame: 128, startValue: 0, endValue: 1 },
                { startFrame: 130, endFrame: 256, startValue: 1, endValue: 0 },
            ],
        });
        // Empty segments.
        send(proc, { type: 'paramAutomation', paramId: 0, segments: [] });
        paramByIdCalls.length = 0;
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toEqual([]);
    });

    it('drainQueue stops at a future sampleFrame and resets the head when drained', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // Queue a hit far in the future.
        send(proc, { type: 'noteOn', pad: 6, velocity: 1, sampleFrame: 50_000 });
        expect(proc._queue.length).toBe(1);
        // Render a block well before the queue head → drains nothing (break).
        vi.stubGlobal('currentFrame', 0);
        proc.process([[]], [[new Float32Array(128), new Float32Array(128)]]);
        expect(noteOnCalls).not.toContain(6);
        // Now advance to drain it → head resets to 0 (empty queue path).
        vi.stubGlobal('currentFrame', 50_000);
        proc.process([[]], [[new Float32Array(128), new Float32Array(128)]]);
        expect(noteOnCalls).toContain(6);
        expect(proc._queue.length).toBe(0);
        expect(proc._queueHead).toBe(0);
        vi.stubGlobal('currentFrame', 0);
    });

    // ── onmessage guards (lines 165, 174, 177) ──────────────────────────────

    it('ignores a second init once already ready (posts ready exactly once)', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const ready = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'ready');
        expect(ready).toHaveLength(1);
    });

    it('reports String(error) when init throws a non-Error value', async () => {
        toasterInitShouldThrow = 'wasm-boom';
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        const errorMsg = vi
            .mocked(proc.port.postMessage)
            .mock.calls.find((c) => (c[0] as { type?: string }).type === 'error');
        expect(errorMsg).toBeDefined();
        expect((errorMsg![0] as { message: string }).message).toBe('wasm-boom');
    });

    it('posts an error and stops taking work when a dispatched message throws while already ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        kitParamCalls.length = 0;
        vi.mocked(proc.port.postMessage).mockClear();

        const spy = vi.spyOn(ToasterInstanceMock.prototype, 'set_param').mockImplementation(() => {
            throw new Error('param trap while ready');
        });
        send(proc, { type: 'param', name: 'swing', value: 0.5 });
        spy.mockRestore();

        const errors = vi
            .mocked(proc.port.postMessage)
            .mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('param trap while ready');

        // A throw here may mean the instance is trapped, so it stops being fed.
        send(proc, { type: 'param', name: 'swing', value: 0.25 });
        expect(kitParamCalls).toEqual([]);
    });

    // ── scheduledHit fill-condition suppression (line 266) ───────────────────

    it('suppresses a fill-conditioned scheduledHit when the fill is not active', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        vi.stubGlobal('currentFrame', 1000);
        // fillCondition 'fill' but _fillActive is false ⇒ break, no note_on.
        send(proc, {
            type: 'scheduledHit',
            pad: 2,
            velocity: 0.9,
            sampleFrame: 1000,
            padParams: [],
            fillCondition: 'fill',
        });
        expect(noteOnCalls).not.toContain(2);
        vi.stubGlobal('currentFrame', 0);
    });

    // ── scheduledHit unmapped padParam fallback (line 273) ───────────────────

    it('forwards an unmapped padParam name as-is during a scheduled hit', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        vi.stubGlobal('currentFrame', 1000);
        send(proc, {
            type: 'scheduledHit',
            pad: 3,
            velocity: 0.8,
            sampleFrame: 1000,
            padParams: [{ name: 'unknownPad', value: 0.42 }],
        });
        // PAD_PARAM_MAP has no 'unknownPad' ⇒ forwarded verbatim.
        expect(padParamCalls).toContainEqual([3, 'unknownPad', 0.42]);
        vi.stubGlobal('currentFrame', 0);
    });

    // ── automation: value unchanged suppresses a redundant set_param_by_id ──

    it('does not re-apply an automation value that equals the last applied value', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        // A flat segment: startValue == endValue, so every frame computes the
        // same value. The first apply writes it; the second finds value ===
        // lastValue and skips the set_param_by_id call.
        send(proc, {
            type: 'paramAutomation',
            paramId: 1,
            segments: [{ startFrame: 0, endFrame: 1024, startValue: 0.5, endValue: 0.5 }],
        });
        paramByIdCalls.length = 0;
        // First render: value 0.5 != lastValue(undefined) ⇒ applied.
        vi.stubGlobal('currentFrame', 0);
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toEqual([[1, 0.5]]);
        // Second render: value 0.5 === lastValue(0.5) ⇒ suppressed.
        paramByIdCalls.length = 0;
        vi.stubGlobal('currentFrame', 128);
        proc.process([[]], [[new Float32Array(8), new Float32Array(8)]]);
        expect(paramByIdCalls).toEqual([]);
        vi.stubGlobal('currentFrame', 0);
    });
});
