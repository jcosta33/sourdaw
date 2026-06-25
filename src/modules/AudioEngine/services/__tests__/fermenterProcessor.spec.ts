import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Worklet global scope shims -------------------------------------------
const registry = new Map<string, new () => FermenterProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

type FermenterProcessorLike = {
    port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: (msg: unknown) => void;
    };
    _queue: unknown[];
    _queueHead: number;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => FermenterProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48000);
vi.stubGlobal('currentFrame', 0);

// --- WASM module mock ------------------------------------------------------
// Records every note_off the worklet issues so the test can assert that one
// allNotesOff message releases the full key range in a single message.
const noteOffCalls: number[] = [];
const noteOnCalls: number[] = [];
const WASM_HEAP = new ArrayBuffer(8192);

class FermenterInstanceMock {
    note_on(note: number): void {
        noteOnCalls.push(note);
    }
    note_off(note: number): void {
        noteOffCalls.push(note);
    }
    set_param(): void {}
    process(): number {
        return 0;
    }
    get_right_ptr(): number {
        return 4096;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: { buffer: WASM_HEAP } })),
    FermenterInstance: FermenterInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function loadProcessor(): Promise<FermenterProcessorLike> {
    await import('../fermenterProcessor');
    const Ctor = registry.get('fermenter-processor');
    if (!Ctor) {
        throw new Error('fermenter-processor was not registered');
    }
    return new Ctor();
}

function send(proc: FermenterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

describe('FermenterProcessor allNotesOff', () => {
    beforeEach(() => {
        noteOffCalls.length = 0;
        noteOnCalls.length = 0;
    });

    // ── Fix 4: a single allNotesOff message releases every held voice ──
    //
    // The transport's stop path used to fan out 128 note-off postMessages per
    // Fermenter device. The processor now honors one allNotesOff message and
    // releases the full MIDI key range itself on the audio thread — so the main
    // thread sends one structured clone, not 128.
    it('releases all 128 MIDI notes on a single allNotesOff message', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

        send(proc, { type: 'allNotesOff' });

        expect(noteOffCalls.length).toBe(128);
        // Every key 0..127 was released exactly once.
        expect(noteOffCalls[0]).toBe(0);
        expect(noteOffCalls[127]).toBe(127);
        expect(new Set(noteOffCalls).size).toBe(128);
    });

    it('drops not-yet-dispatched scheduled notes so a queued noteOn cannot retrigger', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmBytes: MINIMAL_WASM });

        // Schedule a future noteOn (sampleFrame past currentFrame=0): it lands in
        // the queue rather than dispatching immediately.
        send(proc, { type: 'noteOn', note: 64, velocity: 100, sampleFrame: 10_000 });
        expect(proc._queue.length).toBe(1);

        send(proc, { type: 'allNotesOff' });

        // The queue is cleared, so a later process() block cannot drain the
        // stale noteOn and resurrect the voice.
        expect(proc._queue.length).toBe(0);
        expect(proc._queueHead).toBe(0);

        const output = [new Float32Array(128), new Float32Array(128)];
        // Drain past the scheduled frame: no noteOn should fire.
        vi.stubGlobal('currentFrame', 20_000);
        proc.process([[]], [output]);
        expect(noteOnCalls).not.toContain(64);
        vi.stubGlobal('currentFrame', 0);
    });
});
