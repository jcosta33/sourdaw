import { describe, it, expect, vi } from 'vitest';

import { makeOfflineFrameScheduler } from '../makeOfflineFrameScheduler';
import { RENDER_QUANTUM_FRAMES } from '../quantiseSuspendFrame';

const SAMPLE_RATE = 48_000;

type QuantisedSuspendRecord = {
    /** The time passed to suspend(), before the context's own round-up. */
    time: number;
    /** The render-quantum frame the context rounds that time up to. */
    frame: number;
    resolve: () => void;
    reject: (reason: Error) => void;
};

type QuantisedContextDouble = {
    ctx: OfflineAudioContext;
    suspends: QuantisedSuspendRecord[];
    /** Every suspend() call, including ones rejected as duplicates. */
    suspendCallCount: () => number;
    /** suspend() calls the context rejected (duplicate quantum or past the render end). */
    rejectionCount: () => number;
    resumeCount: () => number;
};

function invalidStateError(frame: number): Error {
    const error = new Error(`Cannot schedule a suspend at frame ${frame} in the same render quantum`);
    error.name = 'InvalidStateError';
    return error;
}

/**
 * Honest OfflineAudioContext double: models Blink's real suspend rule. It
 * rejects a suspend whose raw time reaches `frameCount / sampleRate` (the
 * render end), truncates `time * sampleRate` to an integer frame and rounds
 * that UP to the render quantum (`audio_utilities::RoundUpToMultiple`), then
 * rejects a second suspend at an already-scheduled quantum with an
 * InvalidStateError-shaped error. Truncating first is what makes a
 * whole-quantum time a no-op instead of drifting one quantum up on float error
 * — the reason a double that accepts any time cannot observe issue #4489.
 */
function makeQuantisedContextDouble(
    sampleRate = SAMPLE_RATE,
    frameCount = Number.POSITIVE_INFINITY
): QuantisedContextDouble {
    const suspends: QuantisedSuspendRecord[] = [];
    const scheduledFrames = new Set<number>();
    let suspendCalls = 0;
    let rejections = 0;
    let resumeCalls = 0;

    class OfflineAudioContextDouble {
        readonly sampleRate = sampleRate;
        currentTime = 0;

        suspend(time: number): Promise<void> {
            suspendCalls += 1;
            // Blink rejects a suspend whose raw time reaches the render end,
            // before it rounds the frame up to the quantum.
            if (time >= frameCount / sampleRate) {
                rejections += 1;
                return Promise.reject(new Error(`cannot suspend at time ${time}: at or past the render end`));
            }
            const frame = Math.trunc(time * sampleRate);
            const quantisedFrame = Math.ceil(frame / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES;
            if (scheduledFrames.has(quantisedFrame)) {
                rejections += 1;
                return Promise.reject(invalidStateError(quantisedFrame));
            }
            scheduledFrames.add(quantisedFrame);
            return new Promise<void>((resolve, reject) => {
                suspends.push({ time, frame: quantisedFrame, resolve, reject });
            });
        }

        resume(): Promise<void> {
            resumeCalls += 1;
            return Promise.resolve();
        }
    }

    return {
        ctx: new OfflineAudioContextDouble() as unknown as OfflineAudioContext,
        suspends,
        suspendCallCount: () => suspendCalls,
        rejectionCount: () => rejections,
        resumeCount: () => resumeCalls,
    };
}

async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('makeOfflineFrameScheduler — keyed by the render-quantum suspend frame', () => {
    it('collapses two calls inside one render quantum into a single suspend and runs both', async () => {
        const { ctx, suspends, suspendCallCount, resumeCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const order: string[] = [];
        const first = vi.fn(() => order.push('first'));
        const second = vi.fn(() => order.push('second'));

        // Frames 24000 and 24050 at 48 kHz both quantise up to 24064.
        schedule(24000 / SAMPLE_RATE, first);
        schedule(24050 / SAMPLE_RATE, second);

        expect(suspendCallCount()).toBe(1);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.frame).toBe(24064);
        // The raw frame the caller asked for, not the quantised key: the context
        // rounds the time up to its suspend frame (24064) itself.
        expect(suspends[0]!.time).toBe(24000 / SAMPLE_RATE);

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(order).toEqual(['first', 'second']);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(resumeCount()).toBe(1);
    });

    it('rejects nothing and runs neither call at registration for a shared quantum', () => {
        const { ctx, suspends, suspendCallCount, rejectionCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        schedule(24000 / SAMPLE_RATE, first);
        schedule(24050 / SAMPLE_RATE, second);

        // The second call joined the first quantum's batch instead of registering
        // its own suspend, so the context saw no duplicate and fired nothing early.
        expect(suspendCallCount()).toBe(1);
        expect(rejectionCount()).toBe(0);
        expect(suspends).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
    });

    it('registers two suspends for two calls more than one quantum apart, each its own batch', async () => {
        const { ctx, suspends, suspendCallCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        // 24000 quantises to 24064 and 24300 to 24320, two quanta apart.
        schedule(24000 / SAMPLE_RATE, first);
        schedule(24300 / SAMPLE_RATE, second);

        expect(suspendCallCount()).toBe(2);
        expect(suspends).toHaveLength(2);
        expect(suspends[0]!.frame).toBe(24064);
        expect(suspends[1]!.frame).toBe(24320);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        suspends[0]!.resolve();
        suspends[1]!.resolve();
        await flushMicrotasks();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('registers one suspend inside the render for a write on its last valid frame', async () => {
        const frameCount = 24_100;
        const { ctx, suspends, suspendCallCount, rejectionCount } = makeQuantisedContextDouble(SAMPLE_RATE, frameCount);
        const schedule = makeOfflineFrameScheduler(ctx);
        const write = vi.fn();

        // 24065 is inside a 24100-frame render but quantises up to 24192, past
        // the render end. The scheduler passes the raw frame so the context
        // accepts the time, rounds it up itself, and nothing fires early.
        schedule(24065 / SAMPLE_RATE, write);

        expect(suspendCallCount()).toBe(1);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.time).toBe(24065 / SAMPLE_RATE);
        // The context still rounds the raw frame up past the render end.
        expect(suspends[0]!.frame).toBe(24_192);
        expect(rejectionCount()).toBe(0);

        // The suspend stays pending — nothing fires at registration or on the
        // next microtask, where a rejection fallback would have fired the write.
        await flushMicrotasks();
        expect(write).not.toHaveBeenCalled();
    });

    it('merges frames 3328 and 3329 into one suspend (the context maps both to 3328)', () => {
        const { ctx, suspends, suspendCallCount, rejectionCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        // 3329 / 48000 truncates to 3328 in the context's `size_t frame = when *
        // sampleRate()`, so both calls land in the same 3328 quantum and must not
        // register two suspends (the second would be rejected as a duplicate).
        schedule(3328 / SAMPLE_RATE, first);
        schedule(3329 / SAMPLE_RATE, second);

        expect(suspendCallCount()).toBe(1);
        expect(rejectionCount()).toBe(0);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.frame).toBe(3328);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
    });

    it('keeps frames 3329 and 3456 apart: two suspends, each callback on its own batch', async () => {
        const { ctx, suspends, suspendCallCount, rejectionCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        // 3329 truncates to 3328 (its own quantum); 3456 truncates to 3455 and
        // rounds up to 3456, so it must not join 3329's batch and run 128 frames
        // early.
        schedule(3329 / SAMPLE_RATE, first);
        schedule(3456 / SAMPLE_RATE, second);

        expect(suspendCallCount()).toBe(2);
        expect(rejectionCount()).toBe(0);
        expect(suspends).toHaveLength(2);
        expect(suspends[0]!.frame).toBe(3328);
        expect(suspends[1]!.frame).toBe(3456);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        suspends[0]!.resolve();
        await flushMicrotasks();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();

        suspends[1]!.resolve();
        await flushMicrotasks();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keys an unstable frame by the context frame it recomputes (6018 -> 6017 -> 6144)', () => {
        const { ctx, suspends, suspendCallCount, rejectionCount } = makeQuantisedContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const call = vi.fn();

        // 6018 / 48000 truncates to 6017 in the context, not the integer 6018, so
        // the exact key measures 6017 and rounds it up to 6144 while still passing
        // the raw 6018 time to suspend().
        schedule(6018 / SAMPLE_RATE, call);

        expect(suspendCallCount()).toBe(1);
        expect(rejectionCount()).toBe(0);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.time).toBe(6018 / SAMPLE_RATE);
        expect(suspends[0]!.frame).toBe(6144);
        expect(call).not.toHaveBeenCalled();
    });
});
