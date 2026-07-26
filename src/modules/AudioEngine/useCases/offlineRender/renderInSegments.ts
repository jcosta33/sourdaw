import { createExportError } from '../../errors/ExportError';

import { RENDER_QUANTUM_FRAMES, RENDER_SEGMENT_SECONDS } from './constants';
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
    /** Wall-clock budget for the whole render. */
    timeoutMs: number;
    /** Render-time distance between cancel checkpoints. Defaults to `RENDER_SEGMENT_SECONDS`. */
    segmentSeconds?: number;
    /** Real render progress in `0..1`, reported once per reached checkpoint. */
    onRenderProgress?: (fraction: number) => void;
    /** Defaults to the global export cancel flag. */
    cancelSource?: RenderCancelSource;
};

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
}: RenderInSegmentsInput): Promise<AudioBuffer> {
    const canSuspend = typeof offlineCtx.suspend === 'function' && typeof offlineCtx.resume === 'function';
    const checkpoints = canSuspend
        ? planCheckpointSeconds({ durationSeconds, segmentSeconds, sampleRate: offlineCtx.sampleRate })
        : [];

    if (checkpoints.length === 0) {
        return renderWithTimeout(offlineCtx, timeoutMs);
    }

    const startedAt = Date.now();
    let stopped = false;
    let contextAbandoned = false;
    let abort: ((error: Error) => void) | null = null;

    const aborted = new Promise<never>((_resolve, reject) => {
        abort = reject;
    });

    /**
     * Every way this render can end without producing a buffer converges here.
     * Closing rejects the outstanding checkpoints and the render promise, which
     * re-enters through the render's own rejection handler — hence the guard, so
     * the context is torn down exactly once.
     */
    function abandonContext(): void {
        if (contextAbandoned) {
            return;
        }
        contextAbandoned = true;
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

                if (Date.now() - startedAt >= timeoutMs) {
                    stopped = true;
                    abort?.(createExportError(`Offline render timed out after ${timeoutMs / 1000}s`));
                    abandonContext();
                    return null;
                }

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

    const rendering = renderWithTimeout(offlineCtx, timeoutMs).then(
        (buffer) => {
            stopped = true;
            return buffer;
        },
        (error: unknown) => {
            stopped = true;
            // The wall-clock guard inside `renderWithTimeout` fires here when the
            // budget runs out between two checkpoints, and that abandons the
            // context exactly as a checkpoint abort does. Only the fulfilled
            // branch above leaves the context alone — it produced a buffer.
            abandonContext();
            throw error instanceof Error ? error : new Error(String(error));
        }
    );

    // `aborted` never resolves, so the race settles on whichever of the two
    // real outcomes happens first.
    return Promise.race([rendering, aborted]);
}
