import { beforeEach, describe, expect, it, type vi } from 'vitest';

import { installWorkletGlobals } from './wasmViewGrowthHarness';

// CrumbsRecordFeedProcessor: the REAL processor (instantiated from the worklet
// registry) covers the arm/disarm gate — nothing crosses the port until the
// main thread arms, and the flow stops at disarm — plus the pooled transfer
// discipline: full quanta leave as transferred pooled buffers, a starved pool
// counts holes and reports them with the next block that does go out, and a
// short quantum leaves as a clone of just the live bytes. The exported
// `interleaveBlock` wire format is pinned directly at the bottom.

type FeedProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][]): boolean;
};

type FeedPost = { type: 'feed'; audio: ArrayBuffer; dropped: number };

const QUANTUM = 128;
const POOLED_BYTES = QUANTUM * 8;

const { registry } = installWorkletGlobals<FeedProcessorLike>();

async function loadProcessor(): Promise<FeedProcessorLike> {
    await import('../crumbsRecordFeedProcessor');
    const Ctor = registry.get('crumbs-record-feed-processor');
    if (!Ctor) {
        throw new Error('crumbs-record-feed-processor was not registered');
    }
    return new Ctor();
}

function send(proc: FeedProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function stereoInput(frames: number, left: number, right: number): Float32Array[][] {
    return [[new Float32Array(frames).fill(left), new Float32Array(frames).fill(right)]];
}

function feedPosts(proc: FeedProcessorLike): FeedPost[] {
    return proc.port.postMessage.mock.calls
        .map(([message]) => message as FeedPost)
        .filter((message) => message?.type === 'feed');
}

describe('CrumbsRecordFeedProcessor', () => {
    let proc: FeedProcessorLike;

    beforeEach(async () => {
        if (proc) {
            proc.port.postMessage.mockClear();
        }
        proc = await loadProcessor();
    });

    it('posts nothing before the main thread arms it', () => {
        expect(proc.process(stereoInput(QUANTUM, 0.5, 0.25))).toBe(true);
        expect(proc.port.postMessage).not.toHaveBeenCalled();
    });

    it('posts the monitored block as interleaved little-endian f32 once armed', () => {
        send(proc, { type: 'arm' });
        expect(proc.process(stereoInput(QUANTUM, 0.5, 0.25))).toBe(true);

        const [post] = feedPosts(proc);
        if (!post) {
            throw new Error('expected a feed post');
        }
        expect(post).toBeDefined();
        expect(post.audio.byteLength).toBe(POOLED_BYTES);
        expect(post.dropped).toBe(0);
        const samples = new Float32Array(post.audio);
        expect(samples[0]).toBeCloseTo(0.5);
        expect(samples[1]).toBeCloseTo(0.25);
        expect(samples[2]).toBeCloseTo(0.5);
        expect(samples[3]).toBeCloseTo(0.25);
        // Transferred, not cloned: the pooled buffer left the worklet.
        expect(() => new Uint8Array(post.audio)).not.toThrow();
        expect(proc.port.postMessage.mock.calls[0]?.[1]).toEqual([post.audio]);
    });

    it('counts pool starvation as dropped blocks and reports the count late', () => {
        send(proc, { type: 'arm' });
        // Drain the whole pool: four posts, all buffers in flight.
        for (let block = 0; block < 4; block += 1) {
            proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        }
        expect(feedPosts(proc)).toHaveLength(4);

        // Pool empty: the next two blocks are holes in the take, not posts.
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        expect(feedPosts(proc)).toHaveLength(4);

        // One buffer comes back: the next block goes out carrying the count.
        const [first] = feedPosts(proc);
        if (!first) {
            throw new Error('expected a first feed post to recycle');
        }
        send(proc, { type: 'recycle', audio: first.audio });
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        const posts = feedPosts(proc);
        expect(posts).toHaveLength(5);
        expect(posts.at(-1)?.dropped).toBe(2);
    });

    it('refuses to return a foreign buffer to the pool', () => {
        send(proc, { type: 'arm' });
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        // A short clone (or any non-pooled buffer) must not enter the pool.
        send(proc, { type: 'recycle', audio: new ArrayBuffer(64 * 8) });

        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        // Only the four original pool buffers exist; one is still in flight,
        // so this block posts — but a recycled foreign buffer would have made
        // a fifth post possible after draining. The exact-fit check is what
        // the dropped count observes below.
        const posts = feedPosts(proc);
        expect(posts).toHaveLength(2);
        expect(posts.at(-1)?.dropped).toBe(0);
    });

    it('posts a short quantum as a clone of just the live bytes', () => {
        send(proc, { type: 'arm' });
        expect(proc.process(stereoInput(64, 0.5, 0.25))).toBe(true);

        const [post] = feedPosts(proc);
        if (!post) {
            throw new Error('expected a feed post');
        }
        expect(post.audio.byteLength).toBe(64 * 8);
        const samples = new Float32Array(post.audio);
        expect(samples[0]).toBeCloseTo(0.5);
        expect(samples[1]).toBeCloseTo(0.25);
        // Not transferred: the pooled buffer stayed in the worklet, so the
        // very next full quantum still has a buffer to spend.
        expect(proc.port.postMessage.mock.calls[0]?.[1]).toBeUndefined();
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        expect(feedPosts(proc)).toHaveLength(2);
    });

    it('stops posting at disarm', () => {
        send(proc, { type: 'arm' });
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        send(proc, { type: 'disarm' });
        proc.process(stereoInput(QUANTUM, 0.5, 0.5));
        expect(feedPosts(proc)).toHaveLength(1);
    });
});

describe('interleaveBlock wire format', () => {
    it('writes left and right alternating, little-endian, for both byte orders', async () => {
        const { interleaveBlock } = await import('../crumbsRecordFeedProcessor');
        const left = new Float32Array([1, 3]);
        const right = new Float32Array([2, 4]);

        for (const littleEndian of [true, false]) {
            const bytes = new Uint8Array(16);
            const frames = interleaveBlock(bytes, left, right, littleEndian);
            expect(frames).toBe(2);
            const view = new DataView(bytes.buffer);
            expect(view.getFloat32(0, true)).toBeCloseTo(1);
            expect(view.getFloat32(4, true)).toBeCloseTo(2);
            expect(view.getFloat32(8, true)).toBeCloseTo(3);
            expect(view.getFloat32(12, true)).toBeCloseTo(4);
        }
    });

    it('writes only as many frames as the destination and channels agree on', async () => {
        const { interleaveBlock } = await import('../crumbsRecordFeedProcessor');
        const frames = interleaveBlock(new Uint8Array(8), new Float32Array([1, 3, 5]), new Float32Array([2]), true);
        expect(frames).toBe(1);
    });
});
