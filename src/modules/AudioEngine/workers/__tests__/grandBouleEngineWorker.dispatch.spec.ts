import { describe, it, expect, vi, beforeEach } from 'vitest';

// Grand Boule worker control-plane: init handshake, stop, and the dispatch()
// switch (noteOn/noteOff/param mapping/sustain/unaCorda/sostenuto/noteOnMidi2/
// temperament/loadAttackClip/allNotesOff). The existing grandBouleEngineWorker
// spec proves the SPSC ring release/acquire; this covers the message state machine.
//
// The worker wires self.onmessage on import and uses MessageChannel + Atomics, so
// we shim `self`/Atomics.pause and mock the WASM module before the lazy import.

const posted: Array<{ type: string; [k: string]: unknown }> = [];
const selfShim = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
    postMessage: vi.fn((m: unknown) => {
        posted.push(m as { type: string });
    }),
};
Object.defineProperty(globalThis, 'self', { configurable: true, value: selfShim });

const calls: Array<{ method: string; args: unknown[] }> = [];
let processShouldThrow = false;

class GrandBouleInstanceMock {
    note_on(note: number, velocity: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_on_with_channel(note: number, velocity: number, _channel: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_off(note: number): void {
        calls.push({ method: 'note_off', args: [note] });
    }
    set_param(name: string, value: number): void {
        calls.push({ method: 'set_param', args: [name, value] });
    }
    set_sustain(position: number): void {
        calls.push({ method: 'set_sustain', args: [position] });
    }
    set_una_corda(engaged: boolean): void {
        calls.push({ method: 'set_una_corda', args: [engaged] });
    }
    set_sostenuto(engaged: boolean): void {
        calls.push({ method: 'set_sostenuto', args: [engaged] });
    }
    note_on_midi2(note: number, vel: number, pitch: number): void {
        calls.push({ method: 'note_on_midi2', args: [note, vel, pitch] });
    }
    set_temperament(index: number): void {
        calls.push({ method: 'set_temperament', args: [index] });
    }
    load_attack_clip(key: number, samples: Float32Array): void {
        calls.push({ method: 'load_attack_clip', args: [key, samples] });
    }
    all_notes_off(): void {
        calls.push({ method: 'all_notes_off', args: [] });
    }
    process(): number {
        if (processShouldThrow) {
            throw new Error('trap');
        }
        return 0;
    }
    get_right_ptr(): number {
        return 0;
    }
}

// The worker uses a real MessageChannel (provided by Node) for its zero-delay
// yield. Provide a controllable MessageChannel so the render loop does not fire
// spuriously during dispatch tests.
const queuedYields: Array<() => void> = [];
vi.stubGlobal(
    'MessageChannel',
    class {
        port1 = {
            onmessage: null as ((ev: MessageEvent) => void) | null,
        };
        port2 = {
            postMessage: () => {
                // Defer: capture the renderLoop callback instead of running it, so
                // dispatch tests stay synchronous and deterministic.
                const cb = this.port1.onmessage;
                if (cb) {
                    queuedYields.push(() => cb({ data: null } as MessageEvent));
                }
            },
        };
    }
);

// A real SharedArrayBuffer-backed control plane the init path parses.
const RING_FRAMES = 128 * 8; // enough for TARGET_AHEAD (128*6)
const HEADER = 2 * Int32Array.BYTES_PER_ELEMENT;
const SAB = new SharedArrayBuffer(HEADER + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT);

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: new WebAssembly.Memory({ initial: 1 }) })),
    GrandBouleInstance: GrandBouleInstanceMock,
}));

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let onmessage: (ev: MessageEvent) => void;

async function loadWorker(): Promise<void> {
    await import('../grandBouleEngineWorker');
    onmessage = selfShim.onmessage!;
}

function send(data: unknown): void {
    onmessage({ data } as MessageEvent);
}

function method(name: string): { method: string; args: unknown[] } | undefined {
    return [...calls].reverse().find((c) => c.method === name);
}

describe('Grand Boule engine worker control plane', () => {
    beforeEach(() => {
        calls.length = 0;
        posted.length = 0;
        queuedYields.length = 0;
        processShouldThrow = false;
        // Reset SAB heads so each init starts clean.
        const ints = new Int32Array(SAB, 0, 2);
        Atomics.store(ints, 0, 0);
        Atomics.store(ints, 1, 0);
    });

    it('drops all control messages before init (no instance yet)', async () => {
        // Must run before any init: the worker module holds singleton state
        // (`instance`), so once a sibling test inits, the no-instance guard is
        // unreachable for the rest of the file. Load + dispatch without init.
        await loadWorker();
        send({ type: 'noteOn', midiNote: 60, velocity: 90 });
        send({ type: 'param', name: 'masterGain', value: 1 });
        send({ type: 'allNotesOff' });
        expect(calls).toEqual([]);
    });

    it('init parses the SAB, builds the instance, posts ready and schedules the first render', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });

        expect(posted.some((m) => m.type === 'ready')).toBe(true);
        // The render yield was scheduled (captured, not run) — proving scheduleRender fired.
        expect(queuedYields).toHaveLength(1);
    });

    it('stop halts the render loop (a subsequent queued yield is a no-op)', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        send({ type: 'stop' });

        const before = calls.length;
        // Run a queued render tick — running=false ⇒ renderLoop returns immediately.
        for (const fn of queuedYields) {
            fn();
        }
        expect(calls.length).toBe(before);
    });

    it('dispatches noteOn, noteOff and allNotesOff to the instance', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        calls.length = 0;

        send({ type: 'noteOn', midiNote: 60, velocity: 90 });
        send({ type: 'noteOff', midiNote: 60, releaseVelocity: 0.5 });
        send({ type: 'allNotesOff' });

        expect(method('note_on')!.args).toEqual([60, 90]);
        expect(method('note_off')!.args).toEqual([60]);
        expect(calls.some((c) => c.method === 'all_notes_off')).toBe(true);
    });

    it('maps known params through PARAM_MAP and falls back to the raw name', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        calls.length = 0;

        send({ type: 'param', name: 'masterGain', value: 0.7 });
        send({ type: 'param', name: 'toneColor', value: 0.3 });
        send({ type: 'param', name: 'unknownParam', value: 1 });

        const params = calls.filter((c) => c.method === 'set_param');
        expect(params).toContainEqual({ method: 'set_param', args: ['master_gain', 0.7] });
        expect(params).toContainEqual({ method: 'set_param', args: ['tone_color', 0.3] });
        expect(params).toContainEqual({ method: 'set_param', args: ['unknownParam', 1] });
    });

    it('forwards sustain, unaCorda and sostenuto pedal messages', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        calls.length = 0;

        send({ type: 'sustain', position: 0.9 });
        send({ type: 'unaCorda', engaged: true });
        send({ type: 'sostenuto', engaged: false });

        expect(method('set_sustain')!.args).toEqual([0.9]);
        expect(method('set_una_corda')!.args).toEqual([true]);
        expect(method('set_sostenuto')!.args).toEqual([false]);
    });

    it('forwards MIDI 2.0 noteOn and temperament index', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        calls.length = 0;

        send({ type: 'noteOnMidi2', midiNote: 72, velocity16bit: 32000, pitchOffsetQ24: 1 << 24 });
        send({ type: 'temperament', index: 2 });

        expect(method('note_on_midi2')!.args).toEqual([72, 32000, 1 << 24]);
        expect(method('set_temperament')!.args).toEqual([2]);
    });

    it('loads an attack clip for a key', async () => {
        await loadWorker();
        send({ type: 'init', wasmBytes: MINIMAL_WASM.buffer, sab: SAB, sampleRate: 48000 });
        calls.length = 0;

        const samples = new Float32Array([0.1, 0.2, 0.3]);
        send({ type: 'loadAttackClip', key: 48, samples });

        const call = method('load_attack_clip')!;
        expect(call.args[0]).toBe(48);
        expect(call.args[1]).toBe(samples);
    });
});
