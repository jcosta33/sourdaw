import { createExportError } from '../../errors/ExportError';

import {
    NO_PROGRESS_POLL_MS,
    NO_PROGRESS_REFERENCE_SAMPLE_RATE,
    NO_PROGRESS_TIMEOUT_MS,
    RENDER_QUANTUM_FRAMES,
    RENDER_SEGMENT_SECONDS,
} from './constants';
import { isCancelRequested } from './isCancelRequested';
import { renderWithTimeout } from './renderWithTimeout';

/**
 * What stops this render, and the error stopping it produces.
 *
 * The mixdown and stem paths stop on the global export cancel flag. Freeze and
 * bounce are not exports — cancelling an export must not kill a freeze — so
 * they inject their own `AbortSignal` here instead, and say so in their own
 * words rather than reporting a cancelled export.
 */
export type RenderCancelSource = {
    isCancelled: () => boolean;
    createCancelError: () => Error;
};

const EXPORT_CANCEL_SOURCE: RenderCancelSource = {
    isCancelled: isCancelRequested,
    createCancelError: () => createExportError('Export cancelled'),
};

type RenderInSegmentsInput = {
    offlineCtx: OfflineAudioContext;
    /** Length of the render in seconds, used to place checkpoints and scale progress. */
    durationSeconds: number;
    /** Wall-clock budget for the unsegmented fallback only; unused when checkpoints are placed. */
    timeoutMs: number;
    /** Render-time distance between cancel checkpoints. Defaults to `RENDER_SEGMENT_SECONDS`. */
    segmentSeconds?: number;
    /** Real render progress in `0..1`, reported once per reached checkpoint. */
    onRenderProgress?: (fraction: number) => void;
    /** Defaults to the global export cancel flag. */
    cancelSource?: RenderCancelSource;
    /** Initialized device processors whose terminal failure must stop this render. */
    runtimeFailures?: readonly Promise<never>[];
    /** Processor round-trips that must succeed before the rendered buffer is accepted. */
    runtimeHealthChecks?: ReadonlyArray<() => Promise<void>>;
};

function createOfflineRuntimeFailureError(error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    return createExportError(`Offline device processor failed: ${detail}`, error);
}

/**
 * Places checkpoints on the render-quantum grid, strictly inside the render.
 *
 * `suspend()` only accepts times that land on a 128-frame boundary and that the
 * render has not already passed, so both ends are excluded and every candidate
 * is snapped to the nearest quantum.
 */
function planCheckpointSeconds({
    durationSeconds,
    segmentSeconds,
    sampleRate,
}: {
    durationSeconds: number;
    segmentSeconds: number;
    sampleRate: number;
}): number[] {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || segmentSeconds <= 0 || sampleRate <= 0) {
        return [];
    }

    const totalFrames = Math.floor(durationSeconds * sampleRate);
    const rawSegmentFrames = Math.round(segmentSeconds * sampleRate);
    const segmentFrames = Math.max(
        RENDER_QUANTUM_FRAMES,
        Math.round(rawSegmentFrames / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES
    );

    const checkpoints: number[] = [];
    for (let frame = segmentFrames; frame < totalFrames; frame += segmentFrames) {
        checkpoints.push(frame / sampleRate);
    }
    return checkpoints;
}

/**
 * `close()` is declared on `AudioContext` but not on `BaseAudioContext`, so the
 * DOM lib says an `OfflineAudioContext` has no such method — while real engines
 * vary on whether it does. Modelling it as optional is the honest shape: the
 * caller must check before calling, which is what the guard below does.
 */
type MaybeClosableOfflineContext = OfflineAudioContext & { close?: () => Promise<void> };

/**
 * Tear down a context whose render has been abandoned.
 *
 * Leaving it suspended is what stops the CPU burn, but it does not release
 * anything: the context, its node graph and any worklet instances stay resident,
 * and every checkpoint scheduled past the abort point is a `suspend()` promise
 * that can never settle, because the render will never reach that time. Those
 * pending promises keep the graph reachable for as long as the closure lives.
 * Closing settles them and lets the whole graph go.
 *
 * `close()` is not universally implemented on `OfflineAudioContext`, and a
 * context that refuses it is still correctly abandoned — the abort has already
 * happened by the time this runs. Teardown must never cost the cancel.
 */
function closeAbandonedContext(offlineCtx: MaybeClosableOfflineContext): void {
    if (typeof offlineCtx.close !== 'function') {
        return;
    }

    try {
        void offlineCtx.close().catch(() => undefined);
    } catch {
        return;
    }
}

/**
 * Runs an offline render as a sequence of suspendable segments so a cancel or a
 * blown time budget can actually stop the work.
 *
 * `OfflineAudioContext` has no abort API, but a suspended context renders
 * nothing: the graph only advances while it is resumed. Scheduling a suspend at
 * each segment boundary therefore gives a real abort point — on cancel the
 * kernel rejects and simply never resumes, so the render stops burning CPU
 * instead of running to completion in the background the way a bare
 * `renderWithTimeout` guard does.
 *
 * Reaching a checkpoint is also the only honest progress signal the API offers,
 * so the same boundaries drive `onRenderProgress` in place of a timer
 * simulation.
 *
 * **A segmented render has no total time cap, deliberately.** The no-progress
 * watchdog is its only automatic abort, so a render that keeps advancing one
 * checkpoint just inside the no-progress budget is never abandoned however long
 * it takes in total — a five-minute project could run for the better part of an
 * hour, with the user's cancel the only way out. That is the intended trade
 * (see {@link NO_PROGRESS_TIMEOUT_MS}): aborting work that is progressing is
 * the failure mode this design exists to remove, and there is no wall-clock
 * number that separates "slow machine, heavy project" from "wedged" without
 * killing the first. `timeoutMs` applies only to the unsegmented fallback.
 *
 * Degradation is deliberate and always toward "render normally": a context
 * without `suspend`, a duration shorter than one segment, or a suspend the
 * implementation refuses all fall back to a plain unsegmented render rather
 * than failing or truncating the audio.
 */
export function renderInSegments({
    offlineCtx,
    durationSeconds,
    timeoutMs,
    segmentSeconds = RENDER_SEGMENT_SECONDS,
    onRenderProgress,
    cancelSource = EXPORT_CANCEL_SOURCE,
    runtimeFailures = [],
    runtimeHealthChecks = [],
}: RenderInSegmentsInput): Promise<AudioBuffer> {
    const canSuspend = typeof offlineCtx.suspend === 'function' && typeof offlineCtx.resume === 'function';
    const checkpoints = canSuspend
        ? planCheckpointSeconds({ durationSeconds, segmentSeconds, sampleRate: offlineCtx.sampleRate })
        : [];

    if (checkpoints.length === 0) {
        let settled = false;
        const rendering = renderWithTimeout(offlineCtx, timeoutMs)
            .then(async (buffer) => {
                try {
                    await Promise.all(runtimeHealthChecks.map((check) => check()));
                } catch (error) {
                    throw createOfflineRuntimeFailureError(error);
                }
                settled = true;
                return buffer;
            })
            .catch((error: unknown) => {
                settled = true;
                closeAbandonedContext(offlineCtx);
                throw error;
            });
        const failures = runtimeFailures.map((failure) =>
            failure.catch((error: unknown) => {
                if (!settled) {
                    settled = true;
                    closeAbandonedContext(offlineCtx);
                }
                throw createOfflineRuntimeFailureError(error);
            })
        );
        return Promise.race([rendering, ...failures]);
    }

    // Consecutive polls that saw no progress, not a wall-clock delta between
    // them. Only a main-thread microtask records progress, so elapsed time here
    // measures event-loop liveness rather than the render: a tab Chrome froze —
    // and an offline render never makes a tab audible, so it *is* freezable — or
    // one long main-thread task hands the next poll a huge delta with nothing
    // actually wrong. On resume the poll and the suspend resolution are both
    // queued with no guaranteed order, so a healthy render could lose that race
    // and be aborted for "no progress". A starved loop delivers *fewer* ticks,
    // so counting them can only ever delay the abort, never invent one.
    let pollsWithoutProgress = 0;
    let stopped = false;
    let contextAbandoned = false;
    let abort: ((error: Error) => void) | null = null;

    const aborted = new Promise<never>((_resolve, reject) => {
        abort = reject;
    });

    // The budget is stated per segment at a reference rate, so it has to be
    // derived here: a segment holds `sampleRate / 128 × segmentSeconds` quanta,
    // and export offers 96 kHz (`ExportDialog`'s rate list), which puts 750 in a
    // 1 s segment against the 375 the constant is derived from. Read raw, the
    // margin the derivation claims would be halved at the top rate we ship.
    const noProgressBudgetMs =
        NO_PROGRESS_TIMEOUT_MS *
        (offlineCtx.sampleRate / NO_PROGRESS_REFERENCE_SAMPLE_RATE) *
        (segmentSeconds / RENDER_SEGMENT_SECONDS);
    const noProgressPollLimit = Math.max(1, Math.ceil(noProgressBudgetMs / NO_PROGRESS_POLL_MS));

    /**
     * Abandon a render that has stopped making progress.
     *
     * An independent timer rather than a check at checkpoint arrival: a wedged
     * render produces no checkpoint, so a check that only runs when one arrives
     * never runs in the one case it exists for.
     *
     * **What this can and cannot stop.** It fires precisely when no checkpoint
     * was reached, which means the context is *running* rather than suspended,
     * and nothing here suspends it — so unlike the cancel branch below it does
     * not go through "reject, and never resume". Its only teardown is
     * `abandonContext()`, and `OfflineAudioContext` has no `close()` in
     * Chromium, so that early-returns too. On a wedge this therefore frees the
     * caller and leaves `startRendering()` running to completion in the
     * background. A stop that reclaims the CPU can only be raised at a
     * checkpoint, by declining to resume, and a wedged render by definition
     * never reaches one.
     */
    const watchdog = setInterval(() => {
        if (stopped) {
            return;
        }
        pollsWithoutProgress += 1;
        if (pollsWithoutProgress < noProgressPollLimit) {
            return;
        }
        stopped = true;
        abort?.(
            createExportError(
                `Offline render made no progress for ${(noProgressBudgetMs / 1000).toFixed(1)}s ` +
                    `(${String(noProgressPollLimit)} polls at ${String(NO_PROGRESS_POLL_MS)}ms)`
            )
        );
        abandonContext();
    }, NO_PROGRESS_POLL_MS);

    /**
     * Every way this render can end without producing a buffer converges here.
     * Closing rejects the outstanding checkpoints and the render promise, which
     * re-enters through the render's own rejection handler — hence the guard, so
     * the context is torn down exactly once.
     *
     * The watchdog is cleared here rather than in the render promise's handlers
     * because being that single convergence point is the whole reason this
     * exists: the checkpoint cancel below abandons the render *without*
     * resuming, so on a context with no `close()` — every Chromium
     * `OfflineAudioContext` — `startRendering()` never settles and neither
     * handler ever runs. A 1 Hz interval left behind there retains this
     * context, its node graph and every worklet instance in it for the page's
     * lifetime, once per cancelled export, freeze or bounce.
     */
    function abandonContext(): void {
        if (contextAbandoned) {
            return;
        }
        contextAbandoned = true;
        clearInterval(watchdog);
        closeAbandonedContext(offlineCtx);
    }

    for (const checkpointSeconds of checkpoints) {
        void offlineCtx.suspend(checkpointSeconds).then(
            () => {
                // The race already settled (completed, timed out, or cancelled at
                // an earlier checkpoint). Resuming now would restart exactly the
                // background CPU burn this kernel exists to stop.
                if (stopped) {
                    return null;
                }

                if (cancelSource.isCancelled()) {
                    stopped = true;
                    // Reject first, so the caller sees the cancel rather than
                    // whatever error tearing the context down produces.
                    abort?.(cancelSource.createCancelError());
                    abandonContext();
                    return null;
                }

                // Reaching a checkpoint *is* the progress signal. A render that
                // keeps arriving here is working, however long it has been
                // running in total, and is never aborted for elapsed time.
                pollsWithoutProgress = 0;
                onRenderProgress?.(checkpointSeconds / durationSeconds);
                return offlineCtx.resume();
            },
            () => {
                // The context refused this checkpoint. Losing a cancel point is
                // acceptable; failing the render over it is not.
                return null;
            }
        );
    }

    // No racing `setTimeout` here, deliberately. `OfflineAudioContext` exposes
    // `startRendering()`, `suspend()` and `resume()` and no abort, so a timer
    // that rejects this promise stops nothing — the render runs to completion in
    // the background and its CPU is reclaimed only when it finishes. The cancel
    // branch in the suspend handler above is the one real stop: it declines to
    // resume, and leaving the context suspended is the only thing that halts the
    // work. The watchdog is not — it fires when no checkpoint was reached, so
    // there is nothing suspended to leave and it frees the caller rather than the
    // CPU, exactly like the timer this replaced. The unsegmented fallback still
    // uses `renderWithTimeout`, because with no checkpoints it has no progress
    // signal and freeing the caller is the most it can do.
    const rendering = offlineCtx
        .startRendering()
        .then(async (buffer) => {
            try {
                await Promise.all(runtimeHealthChecks.map((check) => check()));
            } catch (error) {
                throw createOfflineRuntimeFailureError(error);
            }
            stopped = true;
            clearInterval(watchdog);
            return buffer;
        })
        .catch((error: unknown) => {
            stopped = true;
            // Only the fulfilled branch above leaves the context alone — it
            // produced a buffer, so it is the one outcome that clears the
            // watchdog itself rather than through `abandonContext`.
            abandonContext();
            throw error instanceof Error ? error : new Error(String(error));
        });

    const failures = runtimeFailures.map((failure) =>
        failure.catch((error: unknown) => {
            if (!stopped) {
                stopped = true;
                abandonContext();
            }
            throw createOfflineRuntimeFailureError(error);
        })
    );

    // `aborted` never resolves, so the race settles on whichever of the two
    // real outcomes happens first.
    return Promise.race([rendering, aborted, ...failures]);
}
