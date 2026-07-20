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
const WASM_HEAP = new ArrayBuffer(8192);

class ToasterInstanceMock {
    note_on(pad: number): void {
        noteOnCalls.push(pad);
    }
    note_off(pad: number): void {
        noteOffCalls.push(pad);
    }
    set_param(): void {}
    set_pad_param(pad: number, name: string, value: number): void {
        padParamCalls.push([pad, name, value]);
    }
    process(): number {
        return 0;
    }
    get_right_ptr(): number {
        return 4096;
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
});
