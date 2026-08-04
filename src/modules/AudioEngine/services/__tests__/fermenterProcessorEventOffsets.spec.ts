import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

/**
 * Sample-accurate note placement for FermenterProcessor.
 *
 * The engine (`MasterSynth::process_block`) has always split its render at each
 * event's sample offset, but the worklet drained its scheduled-note queue and
 * fired every event through the immediate setters *before* calling `process()`,
 * so every scheduled note landed on the 128-frame block boundary. These tests
 * measure the delivered onset frame against the requested one.
 *
 * `fermenterProcessor.spec.ts` covers the queue's *window* decisions (which
 * block a note belongs to); this file covers its *offset within* that block.
 */

type AppliedEvent = {
    kind: 'on' | 'off' | 'expression';
    note: number;
    /** Sample offset within the block the engine was told to apply this at. */
    offset: number;
    velocity?: number;
    channel?: number | null;
};

type FermenterProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    _queue: unknown[];
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<FermenterProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const applied: AppliedEvent[] = [];
/** Events the mock engine holds in its per-block list, cleared by `process`. */
let pendingEventCount = 0;
/**
 * The mock engine's per-block event list size. It stands in for
 * MAX_BLOCK_EVENTS in crates/daw-dsp/src/fermenter/mod.rs, but the processor
 * never reads a capacity — it only reacts to a `false` return — so this is the
 * mock's own limit, chosen to exercise the refusal branch.
 */
const ENGINE_EVENT_CAPACITY = 256;

class FermenterInstanceMock {
    // ── Immediate setters ────────────────────────────────────────────
    // These take effect at the start of the next render, which is offset 0
    // of the block. Recording them as offset 0 is what they mean, and it is
    // what made the block-boundary quantisation measurable.
    note_on(note: number, velocity: number): void {
        applied.push({ kind: 'on', note, velocity, channel: 0, offset: 0 });
    }
    note_on_with_channel(note: number, velocity: number, channel: number): void {
        applied.push({ kind: 'on', note, velocity, channel, offset: 0 });
    }
    note_off(note: number): void {
        applied.push({ kind: 'off', note, channel: null, offset: 0 });
    }
    note_off_on_channel(note: number, channel: number): void {
        applied.push({ kind: 'off', note, channel, offset: 0 });
    }
    note_expression(note: number, channel: number): void {
        applied.push({ kind: 'expression', note, channel, offset: 0 });
    }

    // ── Offset-carrying per-block event list ─────────────────────────
    // Each returns false once full, exactly as the Rust `push_*` do.
    _accept(event: AppliedEvent): boolean {
        if (pendingEventCount >= ENGINE_EVENT_CAPACITY) {
            return false;
        }
        pendingEventCount++;
        applied.push(event);
        return true;
    }
    push_note_on(note: number, velocity: number, channel: number, offset: number): boolean {
        return this._accept({ kind: 'on', note, velocity, channel, offset });
    }
    push_note_off(note: number, offset: number): boolean {
        return this._accept({ kind: 'off', note, channel: null, offset });
    }
    push_note_off_on_channel(note: number, channel: number, offset: number): boolean {
        return this._accept({ kind: 'off', note, channel, offset });
    }
    push_note_expression(
        note: number,
        channel: number,
        _bendSemitones: number,
        _pressure: number,
        _slide: number,
        offset: number
    ): boolean {
        return this._accept({ kind: 'expression', note, channel, offset });
    }

    set_param(): void {}
    set_param_by_id(): void {}
    process(frames: number): number {
        pendingEventCount = 0;
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        left.fill(0);
        right.fill(0);
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    FermenterInstance: FermenterInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<FermenterProcessorLike> {
    await import('../fermenterProcessor');
    const Ctor = registry.get('fermenter-processor');
    if (!Ctor) {
        throw new Error('fermenter-processor was not registered');
    }
    const proc = new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
    proc.port.onmessage?.({ data: { type: 'init' } });
    applied.length = 0;
    pendingEventCount = 0;
    return proc;
}

function send(proc: FermenterProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

/**
 * Run `blockCount` render quanta starting at absolute frame 0 and return every
 * event the engine was given, tagged with the absolute frame it lands on.
 */
function renderBlocks(
    proc: FermenterProcessorLike,
    blockCount: number
): Array<AppliedEvent & { absoluteFrame: number }> {
    const delivered: Array<AppliedEvent & { absoluteFrame: number }> = [];
    for (let block = 0; block < blockCount; block++) {
        const blockStart = block * FRAMES;
        vi.stubGlobal('currentFrame', blockStart);
        const before = applied.length;
        proc.process([], [makeChannels(2, FRAMES)]);
        for (let index = before; index < applied.length; index++) {
            const event = applied[index]!;
            delivered.push({ ...event, absoluteFrame: blockStart + event.offset });
        }
    }
    return delivered;
}

describe('FermenterProcessor scheduled-note sample offsets', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        applied.length = 0;
        pendingEventCount = 0;
        vi.stubGlobal('currentFrame', 0);
    });

    afterEach(() => {
        vi.stubGlobal('currentFrame', 0);
    });

    it('places a note requested mid-block at its own sample offset, not at the block start', async () => {
        const proc = await loadProcessor();
        // Frame 1000 sits inside the block covering [896, 1024) — 104 frames in.
        send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 1000 });

        const delivered = renderBlocks(proc, 9);

        expect(delivered).toEqual([
            { kind: 'on', note: 60, velocity: 100, channel: 0, offset: 104, absoluteFrame: 1000 },
        ]);
    });

    it('delivers every frame across one block at zero error, with no sawtooth', async () => {
        // Notes 0..127 requested at consecutive frames 896..1023 — one per frame
        // of the block covering [896, 1024). Any block-boundary quantisation
        // shows up here as a ramp of errors from 0 down to -127.
        const proc = await loadProcessor();
        const baseFrame = 896;
        for (let note = 0; note < 128; note++) {
            send(proc, { type: 'noteOn', note, velocity: 100, sampleFrame: baseFrame + note });
        }

        const delivered = renderBlocks(proc, 9);

        expect(delivered).toHaveLength(128);
        const errorByNote = delivered.map((event) => event.absoluteFrame - (baseFrame + event.note));
        expect(errorByNote).toEqual(Array.from({ length: 128 }, () => 0));
    });

    it('gives a note landing exactly on the block start an offset of 0', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'noteOn', note: 55, velocity: 90, sampleFrame: 256 });

        const delivered = renderBlocks(proc, 3);

        expect(delivered).toEqual([{ kind: 'on', note: 55, velocity: 90, channel: 0, offset: 0, absoluteFrame: 256 }]);
    });

    it('keeps a note-off after its note-on when both fall in one block', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'noteOn', note: 64, velocity: 100, sampleFrame: 140 });
        send(proc, { type: 'noteOff', note: 64, sampleFrame: 200 });

        const delivered = renderBlocks(proc, 2);

        expect(delivered).toEqual([
            { kind: 'on', note: 64, velocity: 100, channel: 0, offset: 12, absoluteFrame: 140 },
            { kind: 'off', note: 64, channel: null, offset: 72, absoluteFrame: 200 },
        ]);
    });

    it('keeps a note-off and a re-trigger of the same note at the same frame in queued order', async () => {
        const proc = await loadProcessor();
        // A legato repeat: release then retrigger at the identical frame. If the
        // engine list were sorted unstably the note would end up silent.
        send(proc, { type: 'noteOff', note: 48, sampleFrame: 160 });
        send(proc, { type: 'noteOn', note: 48, velocity: 70, sampleFrame: 160 });

        const delivered = renderBlocks(proc, 2);

        expect(delivered).toEqual([
            { kind: 'off', note: 48, channel: null, offset: 32, absoluteFrame: 160 },
            { kind: 'on', note: 48, velocity: 70, channel: 0, offset: 32, absoluteFrame: 160 },
        ]);
    });

    it('keeps older queued events ahead of messages arriving exactly at the block start', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'noteOff', note: 48, sampleFrame: 128 });

        vi.stubGlobal('currentFrame', 128);
        send(proc, { type: 'noteOn', note: 48, velocity: 70, sampleFrame: 128, channel: 3 });
        send(proc, {
            type: 'noteExpression',
            note: 48,
            channel: 3,
            bendSemitones: 1.5,
            pressure: 0.5,
            slide: 0.25,
            sampleFrame: 128,
        });
        expect(applied).toEqual([]);

        proc.process([], [makeChannels(2, FRAMES)]);

        expect(applied).toEqual([
            { kind: 'off', note: 48, channel: null, offset: 0 },
            { kind: 'on', note: 48, velocity: 70, channel: 3, offset: 0 },
            { kind: 'expression', note: 48, channel: 3, offset: 0 },
        ]);
    });

    it('carries MPE expression at its own offset, behind the note-on it bends', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'noteOn', note: 72, velocity: 100, sampleFrame: 300, channel: 3 });
        send(proc, {
            type: 'noteExpression',
            note: 72,
            channel: 3,
            bendSemitones: 1.5,
            pressure: 0.5,
            slide: 0.25,
            sampleFrame: 300,
        });

        const delivered = renderBlocks(proc, 4);

        expect(delivered).toEqual([
            { kind: 'on', note: 72, velocity: 100, channel: 3, offset: 44, absoluteFrame: 300 },
            { kind: 'expression', note: 72, channel: 3, offset: 44, absoluteFrame: 300 },
        ]);
    });

    it('holds events back rather than dropping them when the block exceeds engine capacity', async () => {
        const proc = await loadProcessor();
        const total = ENGINE_EVENT_CAPACITY + 10;
        for (let index = 0; index < total; index++) {
            // All inside the block covering [128, 256): the engine list cannot
            // hold them all, so the tail must wait a block rather than vanish.
            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 128 + (index % FRAMES) });
        }

        vi.stubGlobal('currentFrame', 128);
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(applied).toHaveLength(ENGINE_EVENT_CAPACITY);

        vi.stubGlobal('currentFrame', 256);
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(applied).toHaveLength(total);
    });

    it('leaves scheduled events queued when the block is declined for a mono output', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 200 });

        // A block with fewer than two output channels returns before rendering.
        // Draining into the engine's list there would strand the note: the list
        // is consumed by the next `process()`, so it would arrive measured
        // against a block that never ran.
        vi.stubGlobal('currentFrame', 128);
        proc.process([], [makeChannels(1, FRAMES)]);
        expect(applied).toEqual([]);

        proc.process([], [makeChannels(2, FRAMES)]);
        expect(applied).toEqual([{ kind: 'on', note: 60, velocity: 100, channel: 0, offset: 72 }]);
    });

    it('releases consumed queue storage during sustained look-ahead scheduling', async () => {
        const proc = await loadProcessor();

        for (let block = 0; block < 512; block++) {
            const blockStart = block * FRAMES;
            vi.stubGlobal('currentFrame', blockStart);
            send(proc, {
                type: 'noteOn',
                note: 60,
                velocity: 100,
                sampleFrame: blockStart + FRAMES,
            });
            proc.process([], [makeChannels(2, FRAMES)]);

            expect(proc._queue).toHaveLength(1);
        }
    });

    it('rejects invalid absolute sample frames instead of pinning or immediately firing them', async () => {
        const proc = await loadProcessor();
        for (const sampleFrame of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
            send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame });
        }

        proc.process([], [makeChannels(2, FRAMES)]);

        expect(proc._queue).toEqual([]);
        expect(applied).toEqual([]);
    });
});
