import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportCancellationState } from '../exportCancellationState';
import { renderInSegments } from '../renderInSegments';

const SAMPLE_RATE = 48_000;

type SegmentedContextHarness = {
    offlineCtx: OfflineAudioContext;
    buffer: AudioBuffer;
    /** Advance the simulated render to the checkpoint scheduled at `seconds`. */
    reachCheckpoint: (seconds: number) => Promise<void>;
    /** Settle `startRendering()` as a real context would once the tail is rendered. */
    finishRendering: () => Promise<void>;
    resumeCount: () => number;
    scheduledCheckpoints: () => number[];
};

/**
 * Models the parts of the OfflineAudioContext suspend contract the kernel relies
 * on: `suspend(t)` resolves only when the render reaches `t`, and the render
 * makes no further progress until `resume()` is called. A checkpoint whose
 * `resume()` never arrives therefore leaves the render permanently stalled —
 * which is exactly the "work actually stopped" property this kernel provides.
 */
function createSegmentedContext(durationSeconds: number): SegmentedContextHarness {
    const suspendResolvers = new Map<number, () => void>();
    const buffer = {
        duration: durationSeconds,
        length: Math.ceil(durationSeconds * SAMPLE_RATE),
        sampleRate: SAMPLE_RATE,
    } as AudioBuffer;

    let resumeCount = 0;
    let resolveRender: ((rendered: AudioBuffer) => void) | null = null;

    const offlineCtx = {
        sampleRate: SAMPLE_RATE,
        length: Math.ceil(durationSeconds * SAMPLE_RATE),
        suspend: (seconds: number): Promise<void> =>
            new Promise<void>((resolve) => {
                suspendResolvers.set(seconds, resolve);
            }),
        resume: (): Promise<void> => {
            resumeCount += 1;
            return Promise.resolve();
        },
        startRendering: (): Promise<AudioBuffer> =>
            new Promise<AudioBuffer>((resolve) => {
                resolveRender = resolve;
            }),
    } as unknown as OfflineAudioContext;

    return {
        offlineCtx,
        buffer,
        reachCheckpoint: async (seconds: number): Promise<void> => {
            const resolver = suspendResolvers.get(seconds);
            if (!resolver) {
                throw new Error(
                    `no checkpoint scheduled at ${seconds}s (scheduled: ${[...suspendResolvers.keys()].join(', ')})`
                );
            }
            resolver();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        },
        finishRendering: async (): Promise<void> => {
            resolveRender?.(buffer);
            await Promise.resolve();
            await Promise.resolve();
        },
        resumeCount: () => resumeCount,
        scheduledCheckpoints: () => [...suspendResolvers.keys()].sort((a, b) => a - b),
    };
}

afterEach(() => {
    exportCancellationState.cancelFlag = false;
    vi.useRealTimers();
});

describe('renderInSegments', () => {
    it('schedules a checkpoint per segment strictly inside the render duration', () => {
        const harness = createSegmentedContext(4);

        void renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 60_000,
            segmentSeconds: 1,
        }).catch(() => undefined);

        expect(harness.scheduledCheckpoints()).toEqual([1, 2, 3]);
    });

    it('stops the render at the first checkpoint after cancel and never resumes it', async () => {
        const harness = createSegmentedContext(4);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 60_000,
            segmentSeconds: 1,
        });

        await harness.reachCheckpoint(1);
        expect(harness.resumeCount()).toBe(1);

        exportCancellationState.cancelFlag = true;
        await harness.reachCheckpoint(2);

        await expect(rendering).rejects.toThrow('Export cancelled');
        // The cancelled checkpoint must NOT be resumed: leaving the context
        // suspended is what actually reclaims the render CPU. A guard that only
        // rejected the promise would still show a second resume here.
        expect(harness.resumeCount()).toBe(1);
    });

    it('reports real elapsed-render progress at each checkpoint rather than a simulated curve', async () => {
        const harness = createSegmentedContext(4);
        const progress: number[] = [];

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 60_000,
            segmentSeconds: 1,
            onRenderProgress: (fraction) => progress.push(fraction),
        });

        await harness.reachCheckpoint(1);
        await harness.reachCheckpoint(2);
        await harness.reachCheckpoint(3);
        await harness.finishRendering();
        await rendering;

        expect(progress).toEqual([0.25, 0.5, 0.75]);
    });

    it('resolves with the buffer produced by startRendering after every segment', async () => {
        const harness = createSegmentedContext(2);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 2,
            timeoutMs: 60_000,
            segmentSeconds: 1,
        });

        await harness.reachCheckpoint(1);
        await harness.finishRendering();

        await expect(rendering).resolves.toBe(harness.buffer);
        expect(harness.resumeCount()).toBe(1);
    });

    it('quantizes checkpoints onto the 128-frame render quantum grid', () => {
        const harness = createSegmentedContext(1);

        void renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 1,
            timeoutMs: 60_000,
            segmentSeconds: 0.3,
        }).catch(() => undefined);

        // 0.3 s at 48 kHz is 14 400 frames — not a multiple of 128, so each
        // checkpoint must land on the nearest quantum boundary instead.
        for (const checkpoint of harness.scheduledCheckpoints()) {
            expect((checkpoint * SAMPLE_RATE) % 128).toBe(0);
        }
        expect(harness.scheduledCheckpoints().length).toBeGreaterThan(0);
    });

    it('aborts at a checkpoint once the render has exceeded its timeout budget', async () => {
        vi.useFakeTimers();
        const harness = createSegmentedContext(4);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 5_000,
            segmentSeconds: 1,
        });

        vi.advanceTimersByTime(6_000);
        await harness.reachCheckpoint(1);

        await expect(rendering).rejects.toThrow(/timed out/);
        expect(harness.resumeCount()).toBe(0);
    });

    it('falls back to an unsegmented render when the context cannot suspend', async () => {
        const buffer = { duration: 1, length: SAMPLE_RATE, sampleRate: SAMPLE_RATE } as AudioBuffer;
        const offlineCtx = {
            sampleRate: SAMPLE_RATE,
            startRendering: () => Promise.resolve(buffer),
        } as unknown as OfflineAudioContext;

        await expect(
            renderInSegments({ offlineCtx, durationSeconds: 4, timeoutMs: 60_000, segmentSeconds: 1 })
        ).resolves.toBe(buffer);
    });

    it('keeps rendering when an individual checkpoint cannot be scheduled', async () => {
        const buffer = { duration: 2, length: 2 * SAMPLE_RATE, sampleRate: SAMPLE_RATE } as AudioBuffer;
        const offlineCtx = {
            sampleRate: SAMPLE_RATE,
            suspend: () => Promise.reject(new Error('suspend time is in the past')),
            resume: () => Promise.resolve(),
            startRendering: () => Promise.resolve(buffer),
        } as unknown as OfflineAudioContext;

        // A rejected suspend must degrade to "no checkpoint here", never to a
        // failed or silent render.
        await expect(
            renderInSegments({ offlineCtx, durationSeconds: 2, timeoutMs: 60_000, segmentSeconds: 1 })
        ).resolves.toBe(buffer);
    });
});
