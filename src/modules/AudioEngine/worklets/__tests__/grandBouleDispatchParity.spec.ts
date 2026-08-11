import { describe, it, expect, vi, beforeAll } from 'vitest';

import { GRAND_BOULE_CONTROL_HEADER_BYTES, GRAND_BOULE_SYNC_INT_COUNT } from '../../models/GrandBouleRingProtocol';
import { type GrandBouleDispatchMsg } from '../../worklets/grandBouleEngineCore';

/**
 * Grand Boule has two engine hosts, and this is the one place they can diverge.
 *
 * The live transport runs the engine in a Web Worker behind a SharedArrayBuffer
 * ring; the offline transport runs it inside a plain `AudioWorkletProcessor`.
 * They share `grandBouleEngineCore` — the message union, `PARAM_MAP`, the note
 * queue, `dispatch` and `receiveGrandBouleMessage` — so a *message* handled in
 * one and not the other fails `pnpm typecheck` at the core's `never` arm.
 *
 * What `tsc` cannot catch is a host wiring the core up differently: a different
 * block-end frame, a missed queue clear on panic, a message class routed around
 * `receiveGrandBouleMessage` entirely. That is what this asserts, by driving both
 * hosts with the same `GrandBouleDispatchMsg[]` at frame 0 against the same
 * engine surface and comparing the recorded call sequences byte for byte.
 *
 * Frame 0 is the honest comparison point. It is where an offline render posts
 * every one of its notes, and it is the one instant at which both hosts agree on
 * the clock by construction: the Worker's ring write head is 0 and its context
 * anchor is 0, and the worklet's `currentFrame` is 0, so both compute a block end
 * of 128.
 */

const BLOCK_FRAMES = 128;
const HOST_SAMPLE_RATE = 48_000;

/** `\0asm` + version 1 — the shortest byte string `new WebAssembly.Module` accepts. */
const EMPTY_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

type EngineCall = { method: string; args: readonly unknown[] };

/** Calls recorded per engine instance, in construction order. */
const callsByInstance: EngineCall[][] = [];

const wasmStub = vi.hoisted(() => ({
    memory: new WebAssembly.Memory({ initial: 1 }),
    LEFT_PTR: 0,
    RIGHT_PTR: 4096 * Float32Array.BYTES_PER_ELEMENT,
}));

class GrandBouleInstanceMock {
    private readonly calls: EngineCall[] = [];

    constructor(
        readonly instanceSampleRate: number,
        readonly voiceCount: number
    ) {
        callsByInstance.push(this.calls);
        this.calls.push({ method: 'construct', args: [instanceSampleRate, voiceCount] });
    }

    private record(method: string, args: readonly unknown[]): void {
        this.calls.push({ method, args });
    }

    note_on(note: number, velocity: number): void {
        this.record('note_on', [note, velocity]);
    }
    note_on_with_channel(note: number, velocity: number, channel: number): void {
        this.record('note_on_with_channel', [note, velocity, channel]);
    }
    note_off(note: number): void {
        this.record('note_off', [note]);
    }
    note_off_on_channel(note: number, channel: number): void {
        this.record('note_off_on_channel', [note, channel]);
    }
    note_expression(note: number, channel: number, bend: number, pressure: number, slide: number): void {
        this.record('note_expression', [note, channel, bend, pressure, slide]);
    }
    set_param(name: string, value: number): void {
        this.record('set_param', [name, value]);
    }
    set_sustain(position: number): void {
        this.record('set_sustain', [position]);
    }
    set_una_corda(engaged: boolean): void {
        this.record('set_una_corda', [engaged]);
    }
    set_sostenuto(engaged: boolean): void {
        this.record('set_sostenuto', [engaged]);
    }
    note_on_midi2(note: number, velocity16bit: number, pitchOffsetQ24: number): void {
        this.record('note_on_midi2', [note, velocity16bit, pitchOffsetQ24]);
    }
    set_temperament(index: number): void {
        this.record('set_temperament', [index]);
    }
    load_attack_clip(key: number, samples: Float32Array): void {
        this.record('load_attack_clip', [key, Array.from(samples)]);
    }
    all_notes_off(): void {
        this.record('all_notes_off', []);
    }
    process(_frames: number): number {
        return wasmStub.LEFT_PTR;
    }
    get_right_ptr(): number {
        return wasmStub.RIGHT_PTR;
    }
    lifecycle_state(): number {
        return 0;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: wasmStub.memory })),
    GrandBouleInstance: GrandBouleInstanceMock,
}));

// ---------------------------------------------------------------------------
// Host globals. Both hosts are module singletons wired to globals at import, so
// the shims have to exist before either import runs.
// ---------------------------------------------------------------------------

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const processorRegistry = new Map<string, new (...args: unknown[]) => ProcessorLike>();
let pendingProcessorPort: HarnessPort | null = null;
let OfflineProcessor: (new (...args: unknown[]) => ProcessorLike) | undefined;

class AudioWorkletProcessorShim {
    readonly port: HarnessPort;
    constructor() {
        if (!pendingProcessorPort) {
            throw new Error('AudioWorkletProcessorShim constructed outside a harness node');
        }
        this.port = pendingProcessorPort;
    }
}

const workerSelf = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
};

/**
 * The worker paces its producer loop through a `MessageChannel` macrotask.
 * Capturing the callback instead of running it keeps this comparison at frame 0:
 * the worker must not render — and therefore must not drain — while the
 * processor is still being driven.
 */
const capturedYields: Array<() => void> = [];

/** The three messages the union carries beyond the framed ones, plus every framed shape. */
const PARITY_MESSAGES: readonly GrandBouleDispatchMsg[] = [
    // Framed, inside the first block: both hosts must voice these immediately.
    { type: 'noteOn', midiNote: 60, velocity: 0.8, sampleFrame: 10, channel: 3 },
    {
        type: 'noteExpression',
        midiNote: 60,
        channel: 3,
        bendSemitones: 1.5,
        pressure: 0.2,
        slide: 0.4,
        sampleFrame: 11,
    },
    { type: 'noteOff', midiNote: 60, sampleFrame: 12, releaseVelocity: 0.5, channel: 3 },
    // Framed with no channel: releases every voice at the pitch.
    { type: 'noteOff', midiNote: 62, sampleFrame: 20 },
    // Framed with no frame at all: voices now.
    { type: 'noteOn', midiNote: 64, velocity: 0.4 },
    // Framed beyond the first block: both hosts must queue these, so neither may
    // record a call for them.
    { type: 'noteOn', midiNote: 67, velocity: 0.9, sampleFrame: 5_000 },
    { type: 'noteOff', midiNote: 67, sampleFrame: 6_000 },
    // Unframed control messages.
    { type: 'param', name: 'masterGain', value: 0.7 },
    { type: 'param', name: 'lidPosition', value: 0.5 },
    { type: 'param', name: 'micPosition', value: 2 },
    { type: 'param', name: 'already_snake_case', value: 0.25 },
    { type: 'sustain', position: 0.6 },
    { type: 'unaCorda', engaged: true },
    { type: 'sostenuto', engaged: false },
    { type: 'noteOnMidi2', midiNote: 72, velocity16bit: 32_000, pitchOffsetQ24: 1_024 },
    { type: 'temperament', index: 4 },
    { type: 'loadAttackClip', key: 21, samples: new Float32Array([0.25, 0.5]) },
    // Panic. Both hosts must forward it. That it also drops the two queued notes
    // is not observable at frame 0 and is guarded in `grandBouleEngineCore.spec`
    // instead, on the shared implementation both hosts route through.
    { type: 'allNotesOff' },
];

describe('the worker and the offline processor dispatch identically', () => {
    let workerCalls: EngineCall[] = [];
    let processorCalls: EngineCall[] = [];
    let processorPort: HarnessPort;

    beforeAll(async () => {
        Object.defineProperty(globalThis, 'self', { configurable: true, value: workerSelf });
        Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => 0 });
        Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => HOST_SAMPLE_RATE });
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, processor: new (...args: unknown[]) => ProcessorLike) => {
            processorRegistry.set(name, processor);
        });
        vi.stubGlobal(
            'MessageChannel',
            class {
                port1 = { onmessage: null as ((event: MessageEvent) => void) | null };
                port2 = {
                    postMessage: () => {
                        const callback = this.port1.onmessage;
                        if (callback) {
                            capturedYields.push(() => callback({ data: null } as MessageEvent));
                        }
                    },
                };
            }
        );

        // --- Host A: the engine Worker, ring mapped, anchored at context frame 0.
        await import('../../workers/grandBouleEngineWorker');
        const ringSab = new SharedArrayBuffer(
            GRAND_BOULE_CONTROL_HEADER_BYTES + BLOCK_FRAMES * 32 * 2 * Float32Array.BYTES_PER_ELEMENT
        );
        workerSelf.onmessage?.({
            data: {
                type: 'init',
                initId: 1,
                wasmModule: EMPTY_WASM_MODULE,
                sab: ringSab,
                sampleRate: HOST_SAMPLE_RATE,
                syncSab: new SharedArrayBuffer(GRAND_BOULE_SYNC_INT_COUNT * Int32Array.BYTES_PER_ELEMENT),
                contextFrame: 0,
            },
        } as MessageEvent);
        workerCalls = callsByInstance[callsByInstance.length - 1] ?? [];

        // --- Host B: the offline processor, at currentFrame 0.
        await import('../grandBouleOfflineProcessor');
        OfflineProcessor = processorRegistry.get('grand-boule-offline-processor');
        if (!OfflineProcessor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }
        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        try {
            new OfflineProcessor({ processorOptions: { wasmModule: EMPTY_WASM_MODULE } });
        } finally {
            pendingProcessorPort = null;
        }
        processorPort = inner;
        processorPort.onmessage?.({ data: { type: 'init' } } as MessageEvent);
        processorCalls = callsByInstance[callsByInstance.length - 1] ?? [];

        for (const msg of PARITY_MESSAGES) {
            workerSelf.onmessage?.({ data: msg } as MessageEvent);
            processorPort.onmessage?.({ data: msg } as MessageEvent);
        }
    });

    it('produces the same engine call sequence from the same messages', () => {
        expect(processorCalls).toEqual(workerCalls);
    });

    it('reports retained fault state to a terminal health check', () => {
        if (!OfflineProcessor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }
        const postMessage = vi.fn();
        const faultPort: HarnessPort = { onmessage: null, postMessage };
        pendingProcessorPort = faultPort;
        try {
            new OfflineProcessor({ processorOptions: {} });
        } finally {
            pendingProcessorPort = null;
        }

        faultPort.onmessage?.({ data: { type: 'init' } } as MessageEvent);
        faultPort.onmessage?.({ data: { type: 'runtimeHealthCheck', requestId: 9 } } as MessageEvent);

        expect(postMessage).toHaveBeenLastCalledWith({
            type: 'runtimeHealth',
            requestId: 9,
            error: 'GrandBouleOfflineProcessor requires a compiled WASM module',
        });
    });

    it('voices the messages it should and queues the ones it should', () => {
        // Stated independently of the comparison above, so a change that broke
        // *both* hosts the same way cannot pass. `masterGain` proves `PARAM_MAP`
        // is applied; the absence of note 67 proves the beyond-the-block notes
        // were queued rather than collapsed onto frame 0.
        expect(workerCalls).toEqual([
            { method: 'construct', args: [HOST_SAMPLE_RATE, 64] },
            { method: 'note_on_with_channel', args: [60, 0.8, 3] },
            { method: 'note_expression', args: [60, 3, 1.5, 0.2, 0.4] },
            { method: 'note_off_on_channel', args: [60, 3] },
            { method: 'note_off', args: [62] },
            { method: 'note_on_with_channel', args: [64, 0.4, 0] },
            { method: 'set_param', args: ['master_gain', 0.7] },
            { method: 'set_param', args: ['lid_position', 0.5] },
            { method: 'set_param', args: ['mic_position', 2] },
            { method: 'set_param', args: ['already_snake_case', 0.25] },
            { method: 'set_sustain', args: [0.6] },
            { method: 'set_una_corda', args: [true] },
            { method: 'set_sostenuto', args: [false] },
            { method: 'note_on_midi2', args: [72, 32_000, 1_024] },
            { method: 'set_temperament', args: [4] },
            { method: 'load_attack_clip', args: [21, [0.25, 0.5]] },
            { method: 'all_notes_off', args: [] },
        ]);
    });
});
