import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNativeDspStrategy } from '../../../repositories/deviceStrategy/NativeDspDeviceStrategy';
import { NO_PROGRESS_POLL_MS, NO_PROGRESS_TIMEOUT_MS } from '../constants';
import { exportCancellationState } from '../exportCancellationState';
import { renderInSegments } from '../renderInSegments';

const createFermenterNodeMock = vi.hoisted(() =>
    vi.fn((_ctx?: BaseAudioContext, _wasmUrl?: string, _onFault?: (message: string) => void) =>
        Promise.resolve({
            workletNode: {} as AudioWorkletNode,
            ready: Promise.resolve({}),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
        })
    )
);

vi.mock('../../../engine/FermenterNode', () => ({
    isFermenterDevice: (deviceType: string) => deviceType === 'fermenter',
    createFermenterNode: createFermenterNodeMock,
}));

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
    closeCount: () => number;
    /** Checkpoint promises still awaiting a settlement of any kind. */
    pendingCheckpoints: () => number[];
};

/**
 * Models the parts of the OfflineAudioContext suspend contract the kernel relies
 * on: `suspend(t)` resolves only when the render reaches `t`, and the render
 * makes no further progress until `resume()` is called. A checkpoint whose
 * `resume()` never arrives therefore leaves the render permanently stalled —
 * which is exactly the "work actually stopped" property this kernel provides.
 *
 * `close()` is modelled the way a torn-down context behaves: the checkpoints the
 * render will now never reach reject instead of hanging, and `startRendering()`
 * rejects rather than resolving a buffer.
 */
function createSegmentedContext(durationSeconds: number, sampleRate: number = SAMPLE_RATE): SegmentedContextHarness {
    type Checkpoint = { resolve: () => void; reject: (error: Error) => void; settled: boolean };
    const checkpoints = new Map<number, Checkpoint>();
    const buffer = {
        duration: durationSeconds,
        length: Math.ceil(durationSeconds * sampleRate),
        sampleRate,
    } as AudioBuffer;

    let resumeCount = 0;
    let closeCount = 0;
    let resolveRender: ((rendered: AudioBuffer) => void) | null = null;
    let rejectRender: ((error: Error) => void) | null = null;

    const offlineCtx = {
        sampleRate,
        length: Math.ceil(durationSeconds * sampleRate),
        suspend: (seconds: number): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                checkpoints.set(seconds, { resolve, reject, settled: false });
            }),
        resume: (): Promise<void> => {
            resumeCount += 1;
            return Promise.resolve();
        },
        startRendering: (): Promise<AudioBuffer> =>
            new Promise<AudioBuffer>((resolve, reject) => {
                resolveRender = resolve;
                rejectRender = reject;
            }),
        close: (): Promise<void> => {
            closeCount += 1;
            for (const checkpoint of checkpoints.values()) {
                if (!checkpoint.settled) {
                    checkpoint.settled = true;
                    checkpoint.reject(new Error('InvalidStateError: context is closed'));
                }
            }
            rejectRender?.(new Error('InvalidStateError: context is closed'));
            return Promise.resolve();
        },
    } as unknown as OfflineAudioContext;

    return {
        offlineCtx,
        buffer,
        reachCheckpoint: async (seconds: number): Promise<void> => {
            const checkpoint = checkpoints.get(seconds);
            if (!checkpoint) {
                throw new Error(
                    `no checkpoint scheduled at ${seconds}s (scheduled: ${[...checkpoints.keys()].join(', ')})`
                );
            }
            checkpoint.settled = true;
            checkpoint.resolve();
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
        scheduledCheckpoints: () => [...checkpoints.keys()].sort((a, b) => a - b),
        closeCount: () => closeCount,
        pendingCheckpoints: () =>
            [...checkpoints.entries()]
                .filter(([, checkpoint]) => !checkpoint.settled)
                .map(([seconds]) => seconds)
                .sort((a, b) => a - b),
    };
}

/**
 * A context shaped the way a real Chromium `OfflineAudioContext` is: whole
 * surface is `startRendering()`, `suspend()` and `resume()`, with **no
 * `close()`**. `closeAbandonedContext` therefore early-returns, so once a
 * checkpoint abandons the render nothing ever settles `startRendering()`.
 */
function createUnclosableContext(): {
    offlineCtx: OfflineAudioContext;
    reachCheckpoint: (seconds: number) => void;
} {
    const checkpointResolvers = new Map<number, () => void>();
    const offlineCtx = {
        sampleRate: SAMPLE_RATE,
        suspend: (seconds: number): Promise<void> =>
            new Promise<void>((resolve) => {
                checkpointResolvers.set(seconds, resolve);
            }),
        resume: () => Promise.resolve(),
        startRendering: () => new Promise<AudioBuffer>(() => undefined),
    } as unknown as OfflineAudioContext;

    return {
        offlineCtx,
        reachCheckpoint: (seconds: number): void => {
            const resolve = checkpointResolvers.get(seconds);
            if (!resolve) {
                throw new Error(`no checkpoint scheduled at ${seconds}s`);
            }
            resolve();
        },
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

    // ── SPEC-offline-live-collapse AC-10 ──────────────────────────────────
    //
    // The deadline used to be a *total elapsed* budget read from `Date.now()`,
    // enforced at every checkpoint and again by a `setTimeout` racing the
    // render promise. It aborted renders that were working, it could not abort
    // the one case that matters (`OfflineAudioContext` has no abort API, so the
    // racing timer rejected a promise while the work continued), and its clock
    // was not monotonic.
    //
    // The two cases replaced here previously asserted that a render was aborted
    // for elapsed time while it was still producing checkpoints. They pinned
    // the defect; they are rewritten, not deleted.
    describe('the render deadline measures progress, not elapsed time', () => {
        it('never aborts a render whose checkpoints keep arriving, however long it has run', async () => {
            vi.useFakeTimers();
            const harness = createSegmentedContext(6);

            const rendering = renderInSegments({
                offlineCtx: harness.offlineCtx,
                durationSeconds: 6,
                timeoutMs: 5_000,
                segmentSeconds: 1,
            });

            // Five segments, each taking 8 s of wall clock — under the 10 s
            // no-progress window but far past both the old 5 s `timeoutMs` and
            // the 60 s floor the export paths apply. A total-elapsed budget
            // aborts this at the first checkpoint past its number.
            for (const checkpoint of [1, 2, 3, 4, 5]) {
                await vi.advanceTimersByTimeAsync(8_000);
                await harness.reachCheckpoint(checkpoint);
            }
            await harness.finishRendering();

            await expect(rendering).resolves.toBe(harness.buffer);
            expect(harness.resumeCount()).toBe(5);
        });

        it('abandons a render whose checkpoints stop, and stops the work rather than only the promise', async () => {
            vi.useFakeTimers();
            const harness = createSegmentedContext(6);

            const rendering = renderInSegments({
                offlineCtx: harness.offlineCtx,
                durationSeconds: 6,
                timeoutMs: 5_000,
                segmentSeconds: 1,
            });
            const settled = expect(rendering).rejects.toThrow(/made no progress/);

            await vi.advanceTimersByTimeAsync(2_000);
            await harness.reachCheckpoint(1);
            // …and then nothing more arrives.
            await vi.advanceTimersByTimeAsync(11_000);

            await settled;
            // The abort is expressed through the suspend loop: the context is
            // left suspended (one resume, from the checkpoint that did arrive)
            // and then closed, so the render is not running in the background.
            // A `setTimeout` rejecting the promise would leave both untouched.
            expect(harness.resumeCount()).toBe(1);
            expect(harness.closeCount()).toBe(1);
            expect(harness.pendingCheckpoints()).toEqual([]);
        });

        it('does not abort a healthy render when a frozen main thread advances the clock between polls', async () => {
            vi.useFakeTimers();
            const harness = createSegmentedContext(4);

            const rendering = renderInSegments({
                offlineCtx: harness.offlineCtx,
                durationSeconds: 4,
                timeoutMs: 60_000,
                segmentSeconds: 1,
            });

            // Chrome froze the backgrounded tab. An offline render never makes
            // a tab audible, so it *is* freezable — and one long main-thread
            // task does the same thing. Thirty seconds of wall clock passed
            // while the event loop delivered nothing, so on resume the watchdog
            // gets ONE tick, not thirty. Elapsed time read at that tick says
            // "no progress for 30s" about a render that is perfectly healthy;
            // counting the ticks the loop actually delivered cannot, because a
            // starved loop yields fewer of them, never more.
            const frozenUntilMs = performance.now() + 30_000;
            const frozenClock = vi.spyOn(performance, 'now').mockReturnValue(frozenUntilMs);
            await vi.advanceTimersByTimeAsync(NO_PROGRESS_POLL_MS);
            frozenClock.mockRestore();

            await harness.reachCheckpoint(1);
            await harness.reachCheckpoint(2);
            await harness.reachCheckpoint(3);
            await harness.finishRendering();

            await expect(rendering).resolves.toBe(harness.buffer);
            expect(harness.resumeCount()).toBe(3);
        });

        it('scales the no-progress budget with the render sample rate', async () => {
            vi.useFakeTimers();
            // Export offers 96 kHz (ExportDialog's rate list) and passes it
            // straight into `new OfflineAudioContext(...)`. One 1 s segment is
            // 750 quanta there against 375 at 48 kHz, so the segment's
            // pessimistic cost doubles: a budget pinned to 48 kHz leaves ~7x
            // margin where the constant's derivation claims 14x.
            const harness = createSegmentedContext(6, 96_000);

            const rendering = renderInSegments({
                offlineCtx: harness.offlineCtx,
                durationSeconds: 6,
                timeoutMs: 60_000,
                segmentSeconds: 1,
            });
            // Keeps the second half's rejection from surfacing as unhandled
            // while the first half runs; the assertions below still read
            // `rendering` itself.
            void rendering.catch(() => undefined);

            // A full 48 kHz budget of silence is inside the scaled one, so this
            // render must still be alive to take its checkpoint...
            await vi.advanceTimersByTimeAsync(NO_PROGRESS_TIMEOUT_MS);
            await harness.reachCheckpoint(1);
            expect(harness.resumeCount()).toBe(1);

            // ...and twice the budget, which is past the scaled one, must abort.
            const settled = expect(rendering).rejects.toThrow(/made no progress/);
            await vi.advanceTimersByTimeAsync(2 * NO_PROGRESS_TIMEOUT_MS);
            await settled;
            expect(harness.resumeCount()).toBe(1);
        });

        it('is unmoved by a system clock that jumps backwards and forwards mid-render', async () => {
            vi.useFakeTimers();
            const harness = createSegmentedContext(4);

            const rendering = renderInSegments({
                offlineCtx: harness.offlineCtx,
                durationSeconds: 4,
                timeoutMs: 5_000,
                segmentSeconds: 1,
            });

            // `setSystemTime` moves `Date.now()` and leaves the monotonic clock
            // alone — which is the whole distinction under test. An hour
            // forward would blow any elapsed budget instantly; an hour back
            // would make one unreachable.
            await vi.advanceTimersByTimeAsync(1_000);
            vi.setSystemTime(new Date(Date.now() + 3_600_000));
            await harness.reachCheckpoint(1);
            await vi.advanceTimersByTimeAsync(1_000);
            vi.setSystemTime(new Date(Date.now() - 7_200_000));
            await harness.reachCheckpoint(2);
            await vi.advanceTimersByTimeAsync(1_000);
            await harness.reachCheckpoint(3);
            await harness.finishRendering();

            await expect(rendering).resolves.toBe(harness.buffer);
            expect(harness.resumeCount()).toBe(3);
        });
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

    it('tears the context down when a cancel abandons the render', async () => {
        const harness = createSegmentedContext(4);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 60_000,
            segmentSeconds: 1,
        });

        exportCancellationState.cancelFlag = true;
        await harness.reachCheckpoint(1);

        await expect(rendering).rejects.toThrow('Export cancelled');
        // Leaving the context suspended stops the CPU burn but keeps the whole
        // node graph — worklet instances included — reachable. Stems can abandon
        // several of these at once, so the abandoned context has to be closed.
        expect(harness.closeCount()).toBe(1);
    });

    it('settles the checkpoints past the cancel point instead of leaving them pending forever', async () => {
        const harness = createSegmentedContext(4);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 60_000,
            segmentSeconds: 1,
        });

        exportCancellationState.cancelFlag = true;
        await harness.reachCheckpoint(1);
        await expect(rendering).rejects.toThrow('Export cancelled');
        await Promise.resolve();

        // Checkpoints at 2 s and 3 s can never be reached once the render is
        // abandoned. Each is a promise whose closure holds the graph alive, so
        // none may still be waiting.
        expect(harness.pendingCheckpoints()).toEqual([]);
    });

    it('tears the context down when a render wedges before its first checkpoint', async () => {
        vi.useFakeTimers();
        const harness = createSegmentedContext(4);

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 4,
            timeoutMs: 5_000,
            segmentSeconds: 1,
        });
        const settled = expect(rendering).rejects.toThrow(/made no progress/);

        // No checkpoint ever arrives. A no-progress check evaluated only *at* a
        // checkpoint would never run here — the case it exists for is exactly
        // the one that produces no checkpoint — so the watchdog has to be an
        // independent timer.
        await vi.advanceTimersByTimeAsync(11_000);

        await settled;
        expect(harness.resumeCount()).toBe(0);
        expect(harness.closeCount()).toBe(1);
        expect(harness.pendingCheckpoints()).toEqual([]);
    });

    it('leaves a completed render alone rather than closing a context that produced a buffer', async () => {
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
        expect(harness.closeCount()).toBe(0);
    });

    it('rejects and abandons the context when an offline device processor fails', async () => {
        const harness = createSegmentedContext(2);
        let rejectRuntimeFailure: ((error: Error) => void) | undefined;
        const runtimeFailure = new Promise<never>((_resolve, reject) => {
            rejectRuntimeFailure = reject;
        });

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 2,
            timeoutMs: 60_000,
            segmentSeconds: 1,
            runtimeFailures: [runtimeFailure],
        });

        rejectRuntimeFailure?.(new Error('GrandBoule offline worklet processor failed'));
        await harness.finishRendering();

        await expect(rendering).rejects.toThrow('GrandBoule offline worklet processor failed');
        expect(harness.closeCount()).toBe(1);
        expect(harness.pendingCheckpoints()).toEqual([]);
    });

    it('rejects the render kernel when a post-ready offline Fermenter processor fails', async () => {
        const harness = createSegmentedContext(2);
        createFermenterNodeMock.mockClear();
        const strategy = await createNativeDspStrategy(harness.offlineCtx, {
            type: 'fermenter',
            parameterValues: {},
        } as never);
        const onFault = createFermenterNodeMock.mock.calls[0]?.[2];
        if (!onFault || !strategy.runtimeFailure) {
            throw new Error('Offline Fermenter did not expose its runtime-failure signal');
        }
        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 2,
            timeoutMs: 60_000,
            segmentSeconds: 1,
            runtimeFailures: [strategy.runtimeFailure],
        });

        onFault('Fermenter offline worklet processor failed');
        await harness.finishRendering();

        await expect(rendering).rejects.toThrow('Fermenter offline worklet processor failed');
        expect(harness.closeCount()).toBe(1);
        expect(harness.pendingCheckpoints()).toEqual([]);
    });

    it('checks terminal device health before accepting a completed render', async () => {
        const harness = createSegmentedContext(2);
        let rejectHealthCheck: ((error: Error) => void) | undefined;
        const runtimeHealthCheck = vi.fn(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectHealthCheck = reject;
                })
        );

        const rendering = renderInSegments({
            offlineCtx: harness.offlineCtx,
            durationSeconds: 2,
            timeoutMs: 60_000,
            segmentSeconds: 1,
            runtimeHealthChecks: [runtimeHealthCheck],
        });

        await harness.reachCheckpoint(1);
        await harness.finishRendering();
        expect(runtimeHealthCheck).toHaveBeenCalledOnce();

        rejectHealthCheck?.(new Error('fault delivered after render completion'));

        await expect(rendering).rejects.toThrow('fault delivered after render completion');
        expect(harness.closeCount()).toBe(1);
    });

    it('still aborts on a context that does not implement close()', async () => {
        const { offlineCtx, reachCheckpoint } = createUnclosableContext();

        const rendering = renderInSegments({ offlineCtx, durationSeconds: 4, timeoutMs: 60_000, segmentSeconds: 1 });

        exportCancellationState.cancelFlag = true;
        reachCheckpoint(1);
        await Promise.resolve();
        await Promise.resolve();

        // `close()` is not universally implemented on OfflineAudioContext, and
        // its absence must not cost the cancel.
        await expect(rendering).rejects.toThrow('Export cancelled');
    });

    it('clears the no-progress watchdog when a cancel abandons a context that cannot be closed', async () => {
        vi.useFakeTimers();
        const { offlineCtx, reachCheckpoint } = createUnclosableContext();

        const rendering = renderInSegments({ offlineCtx, durationSeconds: 4, timeoutMs: 60_000, segmentSeconds: 1 });
        expect(vi.getTimerCount()).toBe(1);

        exportCancellationState.cancelFlag = true;
        reachCheckpoint(1);
        await expect(rendering).rejects.toThrow('Export cancelled');

        // The cancel branch returns without resuming, so `startRendering()`
        // never settles — and on a context with no `close()`, which is every
        // Chromium `OfflineAudioContext`, nothing else settles it either. Both
        // handlers that used to hold the only `clearInterval` are therefore
        // dead. A surviving 1 Hz interval retains the context, its offline node
        // graph, every worklet instance in it and the abandon closure for the
        // page's lifetime — one leak per cancelled export, freeze or bounce.
        expect(vi.getTimerCount()).toBe(0);
    });
});
