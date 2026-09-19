import { describe, it, expect, vi } from 'vitest';

import { makeOfflineFrameScheduler } from '../makeOfflineFrameScheduler';

const SAMPLE_RATE = 48_000;
// Far below half a sample frame (1 / 96_000 s), so the two times stay in one frame.
const SUB_FRAME_DRIFT = 1e-9;

type SuspendRecord = {
    time: number;
    resolve: () => void;
    reject: (reason: Error) => void;
};

type ContextDouble = {
    ctx: OfflineAudioContext;
    suspends: SuspendRecord[];
    resumeCount: () => number;
};

type SuspendMode = 'defer' | 'throw';

type ContextDoubleOptions = {
    sampleRate?: number;
    currentTime?: number;
    suspendMode?: SuspendMode;
};

/** Controllable OfflineAudioContext double: records every suspend(time) and settles it on demand. */
function makeContextDouble(options: ContextDoubleOptions = {}): ContextDouble {
    const suspends: SuspendRecord[] = [];
    const sampleRate = options.sampleRate ?? SAMPLE_RATE;
    const suspendMode = options.suspendMode ?? 'defer';
    let resumeCount = 0;

    const ctx = {
        sampleRate,
        currentTime: options.currentTime ?? 0,
        suspend(time: number): Promise<void> {
            if (suspendMode === 'throw') {
                throw new Error('suspend threw synchronously');
            }
            return new Promise<void>((resolve, reject) => {
                suspends.push({ time, resolve, reject });
            });
        },
        resume(): Promise<void> {
            resumeCount += 1;
            return Promise.resolve();
        },
    };

    return { ctx: ctx as unknown as OfflineAudioContext, suspends, resumeCount: () => resumeCount };
}

async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('makeOfflineFrameScheduler — immediate path', () => {
    it('runs a call at or before currentTime immediately and registers no suspend', () => {
        const { ctx, suspends } = makeContextDouble({ currentTime: 5 });
        const schedule = makeOfflineFrameScheduler(ctx);
        const atPresent = vi.fn();
        const inPast = vi.fn();
        const withoutTime = vi.fn();

        schedule(5, atPresent);
        schedule(4.9, inPast);
        schedule(undefined, withoutTime);

        expect(atPresent).toHaveBeenCalledTimes(1);
        expect(inPast).toHaveBeenCalledTimes(1);
        expect(withoutTime).toHaveBeenCalledTimes(1);
        expect(suspends).toHaveLength(0);
    });
});

describe('makeOfflineFrameScheduler — one suspend per quantised frame', () => {
    it('registers exactly one suspend for two calls on the same frame and runs both in registration order', async () => {
        const { ctx, suspends, resumeCount } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const order: string[] = [];
        const first = vi.fn(() => order.push('first'));
        const second = vi.fn(() => order.push('second'));

        schedule(1, first);
        schedule(1, second);

        // A second suspend for an already-scheduled frame throws, so the second
        // call joins the first frame's batch instead of registering its own.
        expect(suspends).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(order).toEqual(['first', 'second']);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(resumeCount()).toBe(1);
    });

    it('collapses near-duplicate times inside one frame into that same single suspend', async () => {
        const { ctx, suspends } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const exact = vi.fn();
        const drifted = vi.fn();

        schedule(1, exact);
        schedule(1 + SUB_FRAME_DRIFT, drifted);

        expect(suspends).toHaveLength(1);

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(exact).toHaveBeenCalledTimes(1);
        expect(drifted).toHaveBeenCalledTimes(1);
    });

    it('registers the suspend at frame / sampleRate for the quantised frame', () => {
        const { ctx, suspends } = makeContextDouble({ sampleRate: SAMPLE_RATE });
        const schedule = makeOfflineFrameScheduler(ctx);
        const drifted = 0.3 + SUB_FRAME_DRIFT;

        schedule(drifted, vi.fn());

        const frame = Math.round(drifted * SAMPLE_RATE);
        expect(frame).toBe(14_400);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.time).toBe(frame / SAMPLE_RATE);
        // The requested time is quantised down onto its frame's exact time.
        expect(suspends[0]!.time).not.toBe(drifted);
    });
});

describe('makeOfflineFrameScheduler — suspend failure fallback', () => {
    it('runs the queued callbacks exactly once when the suspend promise rejects', async () => {
        const { ctx, suspends } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        schedule(1, first);
        schedule(1, second);

        expect(suspends).toHaveLength(1);
        suspends[0]!.reject(new Error('frame already passed'));
        await flushMicrotasks();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('runs each call exactly once when suspend throws synchronously', () => {
        const { ctx, suspends } = makeContextDouble({ suspendMode: 'throw' });
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        expect(() => {
            schedule(1, first);
            schedule(1, second);
        }).not.toThrow();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(suspends).toHaveLength(0);
    });
});
