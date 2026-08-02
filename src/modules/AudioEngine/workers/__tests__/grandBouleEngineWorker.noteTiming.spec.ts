import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { installWorkletGlobals, makeChannels } from '../../services/__tests__/wasmViewGrowthHarness';

/**
 * Where a Grand Boule note actually lands, measured against the engine's own
 * render cursor.
 *
 * The engine runs in this worker and counts the frames it has produced (the ring
 * write head). Every `sampleFrame` in the app is an *AudioContext* frame. The
 * two clocks differ by however far the consuming worklet is ahead of the frames
 * it has read, which only the worklet can measure — so this drives the real
 * `GrandBouleProcessor` over the same SABs rather than asserting the worker
 * against a number the spec made up.
 */

const BLOCK_FRAMES = 128;
const RING_FRAMES = BLOCK_FRAMES * 32;
const RING_HEADER_BYTES = 2 * Int32Array.BYTES_PER_ELEMENT;
const WRITE_HEAD_IDX = 0;
/** Frames of headroom the worker keeps ahead of the consumer (TARGET_AHEAD). */
const PRE_ROLL_FRAMES = BLOCK_FRAMES * 6;

const ringSab = new SharedArrayBuffer(RING_HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT);
const ringControlInts = new Int32Array(ringSab, 0, 2);
const syncSab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);

const wasmMemory = new WebAssembly.Memory({ initial: 1 });
const LEFT_PTR = 0;
const RIGHT_PTR = BLOCK_FRAMES * Float32Array.BYTES_PER_ELEMENT;

/** Engine block the worker is about to produce when a note is voiced. */
type Voiced = { note: number; block: number };
const voiced: Voiced[] = [];

class GrandBouleInstanceMock {
    note_on_with_channel(note: number, _velocity: number, _channel: number): void {
        voiced.push({ note, block: Atomics.load(ringControlInts, WRITE_HEAD_IDX) / BLOCK_FRAMES });
    }
    note_off(_note: number): void {}
    note_off_on_channel(_note: number, _channel: number): void {}
    note_expression(): void {}
    set_param(): void {}
    set_sustain(): void {}
    set_una_corda(): void {}
    set_sostenuto(): void {}
    note_on_midi2(): void {}
    set_temperament(): void {}
    load_attack_clip(): void {}
    all_notes_off(): void {}
    process(_frames: number): number {
        return LEFT_PTR;
    }
    get_right_ptr(): number {
        return RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: wasmMemory })),
    GrandBouleInstance: GrandBouleInstanceMock,
}));

// The worker's zero-delay yield. Hold the callback instead of queuing it so each
// render tick is driven explicitly and nothing fires between assertions.
const yieldHolder = { run: null as null | (() => void) };
vi.stubGlobal(
    'MessageChannel',
    class {
        port1 = {
            onmessage: null as ((event: MessageEvent) => void) | null,
        };
        port2 = {
            postMessage: (generation: number) => {
                yieldHolder.run = () => this.port1.onmessage?.({ data: generation } as MessageEvent);
            },
        };
    }
);

const workerSelf = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
};
Object.defineProperty(globalThis, 'self', { configurable: true, value: workerSelf });

type GrandBouleProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
const { registry } = installWorkletGlobals<GrandBouleProcessorLike>();

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

function send(data: unknown): void {
    workerSelf.onmessage?.({ data } as MessageEvent);
}

/** One pass of the worker's render loop. */
function renderTick(): void {
    yieldHolder.run?.();
}

function writeHead(): number {
    return Atomics.load(ringControlInts, WRITE_HEAD_IDX);
}

let consumer: GrandBouleProcessorLike;

/** Consume one block through the real worklet, as the context clock stands. */
function consumeBlock(contextFrame: number): void {
    vi.stubGlobal('currentFrame', contextFrame);
    consumer.process([], [makeChannels(2, BLOCK_FRAMES)]);
}

/**
 * Run `blocks` context quanta with the consumer keeping pace, so the engine is
 * free to render past its headroom. Context frame and read head stay equal, so
 * the published offset is 0 and engine frames are context frames here.
 */
function runEngineTo(blocks: number): void {
    for (let block = 0; block < blocks; block++) {
        consumeBlock(block * BLOCK_FRAMES);
        renderTick();
    }
}

describe('Grand Boule engine worker note placement', () => {
    beforeEach(async () => {
        voiced.length = 0;
        await import('../grandBouleEngineWorker');
        await import('../../services/grandBouleProcessor');

        // Anchor 0: what an OfflineAudioContext reports before it renders. Every
        // test that cares about a live offset has the consumer publish one.
        send({
            type: 'init',
            initId: 1,
            wasmModule: MINIMAL_WASM_MODULE,
            sab: ringSab,
            sampleRate: 48_000,
            syncSab,
            contextFrame: 0,
        });

        const Ctor = registry.get('grand-boule-processor');
        if (!Ctor) {
            throw new Error('grand-boule-processor was not registered');
        }
        consumer = new Ctor();
        consumer.port.onmessage?.({ data: { type: 'init', sab: ringSab, syncSab } });
    });

    // The worker wires its yield channel once, at module scope, so the captured
    // callback outlives every test in this file and must not be cleared here.
    afterEach(() => {
        send({ type: 'stop' });
    });

    it('places a note by the consumer clock, not by the frames the engine has produced', () => {
        // Pre-roll: the worker runs ahead of the consumer, so engine frame N is
        // not context frame N and never was.
        renderTick();
        expect(writeHead()).toBe(PRE_ROLL_FRAMES);

        // A live context has been running for a while. Consuming one block
        // publishes the real gap between the two clocks.
        const contextStart = 5000 * BLOCK_FRAMES;
        consumeBlock(contextStart);

        // Engine frame 900 lives in engine block 7 (896..1023). Address it the
        // only way the app can: by the context frame it will be heard at.
        send({ type: 'noteOn', midiNote: 60, velocity: 90, sampleFrame: contextStart + 900, channel: 0 });
        expect(voiced).toEqual([]);

        // Let the engine reach that block, feeding the consumer as it goes.
        for (let block = 1; block <= 8; block++) {
            renderTick();
            consumeBlock(contextStart + block * BLOCK_FRAMES);
        }

        expect(voiced).toEqual([{ note: 60, block: 7 }]);
    });

    it('places a frame sitting exactly on a block boundary in that block, not the one before', () => {
        renderTick();

        // Frame 1280 is the first frame of block 10, and sits past the pre-roll
        // so it is genuinely queued. Draining on `>` instead of `>=` voices it
        // at the end of block 9 — one block early, silently.
        send({ type: 'noteOn', midiNote: 62, velocity: 90, sampleFrame: 10 * BLOCK_FRAMES, channel: 0 });
        expect(voiced).toEqual([]);

        runEngineTo(14);

        expect(voiced).toEqual([{ note: 62, block: 10 }]);
    });

    it('voices a note whose frame the engine has already passed instead of holding it', () => {
        renderTick();
        const passed = writeHead() - BLOCK_FRAMES;

        send({ type: 'noteOn', midiNote: 64, velocity: 90, sampleFrame: passed, channel: 0 });

        // Dispatched on arrival — at the head the engine is already at, not the
        // block that frame belonged to and not a block later.
        expect(voiced).toEqual([{ note: 64, block: PRE_ROLL_FRAMES / BLOCK_FRAMES }]);
    });

    it('drops notes still waiting in the queue when the device panics', () => {
        renderTick();
        send({ type: 'noteOn', midiNote: 67, velocity: 90, sampleFrame: 20 * BLOCK_FRAMES, channel: 0 });
        expect(voiced).toEqual([]);

        send({ type: 'allNotesOff' });
        runEngineTo(24);

        // The engine ran past frame 2560, so the note was reachable; the panic
        // must have taken it rather than letting the look-ahead window arrive
        // after the user asked for silence.
        expect({ voiced, enginePassedTheNote: writeHead() > 20 * BLOCK_FRAMES }).toEqual({
            voiced: [],
            enginePassedTheNote: true,
        });
    });
});
