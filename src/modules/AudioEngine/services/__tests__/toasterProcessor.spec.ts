import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
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
        postMessage: (msg: unknown) => void;
    };
    _queue: unknown[];
    _queueHead: number;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => ToasterProcessorLike) => {
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
const processCalls: number[] = [];
let padZeroDryRouted = false;
const WASM_BLOCK_SAMPLES = 4096;
const WASM_CHANNEL_BYTES = WASM_BLOCK_SAMPLES * Float32Array.BYTES_PER_ELEMENT;
const WASM_HEAP = new ArrayBuffer((2 + 16 * 2) * WASM_CHANNEL_BYTES);

class ToasterInstanceMock {
    note_on(pad: number): void {
        noteOnCalls.push(pad);
    }
    note_off(pad: number): void {
        noteOffCalls.push(pad);
    }
    set_param(): void {}
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
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
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

describe('ToasterProcessor allNotesOff', () => {
    beforeEach(() => {
        noteOffCalls.length = 0;
        noteOnCalls.length = 0;
        padParamCalls.length = 0;
        padDryRoutedCalls.length = 0;
        paramByIdCalls.length = 0;
        padZeroDryRouted = false;
        processCalls.length = 0;
        vi.stubGlobal('currentFrame', 0);
    });

    it('evaluates numeric parameter schedules once per render quantum', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

        send(proc, { type: 'allNotesOff' });

        expect(noteOffCalls.length).toBe(16);
        expect(noteOffCalls[0]).toBe(0);
        expect(noteOffCalls[15]).toBe(15);
        expect(new Set(noteOffCalls).size).toBe(16);
    });

    it('drops not-yet-dispatched scheduled hits so a queued noteOn cannot retrigger', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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

    it('excludes routed pad dry signal while preserving its tap and restores it on reset', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });
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
