import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit RT-10 — Grand Boule's ring-buffer starvation is the one dropout the
 * engine genuinely detects on the worklet side: when the engine Worker has not
 * published a full quantum, the processor outputs silence. It used to do that
 * with no trace at all. Now it bumps the shared dropout counters.
 *
 * These specs drive the real processor, not a stand-in: a fed ring must leave
 * the tally at zero, a starved ring must increment it, and the pre-roll gap
 * before the Worker's very first block must not be counted as a dropout.
 */

type GrandBouleProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const registry = new Map<string, new () => GrandBouleProcessorLike>();

class AudioWorkletProcessorShim {
    port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
    };
}

vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
vi.stubGlobal('registerProcessor', (name: string, proc: new () => GrandBouleProcessorLike) => {
    registry.set(name, proc);
});
vi.stubGlobal('sampleRate', 48_000);
vi.stubGlobal('currentFrame', 12_800);

// Mirrors DROPOUT_IDX in engine/dropoutCounter.ts (worklet stays isolated).
const BLOCKS_IDX = 0;
const SILENT_FRAMES_IDX = 1;
const LAST_FRAME_IDX = 2;

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;
const SLEEP_HEAD_IDX = 3;
const LIFECYCLE_IDX = 4;
const RING_FRAMES = 1_024;
const FRAMES = 128;
const HEADER_BYTES = 7 * Int32Array.BYTES_PER_ELEMENT;

function makeRingSab(): { sab: SharedArrayBuffer; controlInts: Int32Array; leftRing: Float32Array } {
    const sab = new SharedArrayBuffer(HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT);
    const controlInts = new Int32Array(sab, 0, 7);
    const leftRing = new Float32Array(sab, HEADER_BYTES, RING_FRAMES);
    return { sab, controlInts, leftRing };
}

async function loadProcessor(): Promise<GrandBouleProcessorLike> {
    await import('../grandBouleProcessor');
    const Ctor = registry.get('grand-boule-processor');
    if (!Ctor) {
        throw new Error('grand-boule-processor was not registered');
    }
    return new Ctor();
}

function renderBlock(proc: GrandBouleProcessorLike): Float32Array[] {
    const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    proc.process([], [output]);
    return output;
}

describe('GrandBouleProcessor dropout counting (audit RT-10)', () => {
    let dropoutSab: SharedArrayBuffer;
    let dropoutInts: Int32Array;
    let ring: ReturnType<typeof makeRingSab>;

    beforeEach(() => {
        dropoutSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
        dropoutInts = new Int32Array(dropoutSab);
        ring = makeRingSab();
    });

    async function readyProcessor(): Promise<GrandBouleProcessorLike> {
        const proc = await loadProcessor();
        proc.port.onmessage?.({ data: { type: 'init', sab: ring.sab, dropoutSab } });
        return proc;
    }

    /** Publish `frames` of recognizable audio into the ring. */
    function publish(frames: number): void {
        const writeHead = Atomics.load(ring.controlInts, WRITE_HEAD_IDX);
        for (let index = 0; index < frames; index++) {
            ring.leftRing[(writeHead + index) % RING_FRAMES] = 0.5;
        }
        Atomics.store(ring.controlInts, WRITE_HEAD_IDX, writeHead + frames);
    }

    it('counts nothing while the worker keeps the ring fed', async () => {
        const proc = await readyProcessor();
        publish(FRAMES * 4);

        for (let block = 0; block < 4; block++) {
            const output = renderBlock(proc);
            expect(output[0]![0]).toBeCloseTo(0.5, 5);
        }

        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(0);
        expect(Atomics.load(dropoutInts, SILENT_FRAMES_IDX)).toBe(0);
        expect(Atomics.load(ring.controlInts, READ_HEAD_IDX)).toBe(FRAMES * 4);
    });

    it('counts a block and its silent frames when the ring starves mid-stream', async () => {
        const proc = await readyProcessor();
        publish(FRAMES);
        renderBlock(proc);

        // Worker fell behind: nothing new published, so this block outputs silence.
        const starved = renderBlock(proc);

        expect(Array.from(starved[0]!).every((sample) => sample === 0)).toBe(true);
        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(1);
        expect(Atomics.load(dropoutInts, SILENT_FRAMES_IDX)).toBe(FRAMES);
        expect(Atomics.load(dropoutInts, LAST_FRAME_IDX)).toBe(12_800);
    });

    it('does not count intentional sleep when lifecycle and drain-boundary reads straddle publication', async () => {
        const proc = await readyProcessor();
        publish(FRAMES);
        renderBlock(proc);

        Atomics.store(ring.controlInts, SLEEP_HEAD_IDX, -1);
        Atomics.store(ring.controlInts, LIFECYCLE_IDX, 3);
        const sleeping = renderBlock(proc);

        expect(Array.from(sleeping[0]!).every((sample) => sample === 0)).toBe(true);
        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(0);
    });

    it('accumulates across consecutive starved blocks and stops when the worker catches up', async () => {
        const proc = await readyProcessor();
        publish(FRAMES);
        renderBlock(proc);

        renderBlock(proc);
        renderBlock(proc);
        renderBlock(proc);
        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(3);
        expect(Atomics.load(dropoutInts, SILENT_FRAMES_IDX)).toBe(FRAMES * 3);

        publish(FRAMES);
        const recovered = renderBlock(proc);

        expect(recovered[0]![0]).toBeCloseTo(0.5, 5);
        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(3);
    });

    it('does not count the pre-roll before the worker has published its first block', async () => {
        const proc = await readyProcessor();

        // Ring empty from the start — this is startup, not a dropout.
        renderBlock(proc);
        renderBlock(proc);

        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(0);

        // Once real audio has flowed, starvation does count.
        publish(FRAMES);
        renderBlock(proc);
        renderBlock(proc);

        expect(Atomics.load(dropoutInts, BLOCKS_IDX)).toBe(1);
    });

    it('renders without a dropout buffer when the host supplies none', async () => {
        const proc = await loadProcessor();
        proc.port.onmessage?.({ data: { type: 'init', sab: ring.sab } });
        publish(FRAMES);

        const output = renderBlock(proc);
        const starved = renderBlock(proc);

        expect(output[0]![0]).toBeCloseTo(0.5, 5);
        expect(Array.from(starved[0]!).every((sample) => sample === 0)).toBe(true);
    });
});
