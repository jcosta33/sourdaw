/**
 * Repository: offline render frame scheduler.
 *
 * Irreducible reason for batching: registering `suspend(time)` for a
 * render-quantum frame that already has one scheduled is rejected with
 * InvalidStateError, so every call due inside one quantum must ride a single
 * suspend.
 *
 * Irreducible reason for one scheduler per context: the same rejection makes a
 * second scheduler over one `OfflineAudioContext` fatal, not merely redundant.
 * Each scheduler answers the rejection with its own fallback, which fires that
 * frame's calls immediately, so a Faust note due at 1.0 s would sound at frame
 * 0. That is why the sharing is guaranteed here, at the factory, instead of
 * being a rule every caller has to remember: no caller can obtain a second
 * scheduler for a context, however many times it asks or from where.
 */

import { quantiseSuspendFrame } from './quantiseSuspendFrame';

export type ScheduleCall = (time: number | undefined, call: () => void) => void;

/**
 * The one scheduler per `OfflineAudioContext`, for the context's whole
 * lifetime. Weak so a finished render's context is collectable.
 *
 * Deliberately unreachable except through the factory below: that is what makes
 * the one-suspend-per-quantum rule structural rather than conventional.
 */
const schedulersByContext = new WeakMap<OfflineAudioContext, ScheduleCall>();

/**
 * Offline scheduler: batch all note events sharing a render quantum behind a
 * single `ctx.suspend(time)` instead of registering O(N) suspend→resume
 * transitions (one per note). The context rounds `suspend(time)` up to the
 * render quantum, so two notes a few sample frames apart previously registered
 * two suspends for one quantum; the second was rejected with InvalidStateError
 * and its fallback fired the note immediately at the wrong time. Keying the
 * batch on the quantised frame collapses them so each distinct quantum gets
 * exactly one suspend whose handler runs every queued call in order, while the
 * suspend itself is still registered at the caller's raw time so a write
 * inside the render is not rejected as past its end.
 *
 * Returns the context's existing scheduler when it already has one, so a Faust
 * device's note calls and a frame-addressed automation write share one batch
 * per quantum instead of racing two suspends for it.
 */
export function makeOfflineFrameScheduler(ctx: OfflineAudioContext): ScheduleCall {
    const existing = schedulersByContext.get(ctx);
    if (existing) {
        return existing;
    }

    const schedule = buildOfflineFrameScheduler(ctx);
    schedulersByContext.set(ctx, schedule);
    return schedule;
}

function buildOfflineFrameScheduler(ctx: OfflineAudioContext): ScheduleCall {
    const { sampleRate } = ctx;
    // The batch key is the render-quantum frame the context rounds its suspend
    // up to, so every call due inside one quantum shares one suspend and the
    // context never sees a duplicate (which it rejects with InvalidStateError).
    const callsByFrame = new Map<number, (() => void)[]>();

    return (time, call) => {
        if (time === undefined || time <= ctx.currentTime) {
            call();
            return;
        }

        // Quantise to the nearest sample frame so float drift between notes that
        // are meant to share a frame does not split into two suspends.
        const frame = Math.max(0, Math.round(time * sampleRate));
        // The key and the time are two separate things:
        //   - the key is the quantised frame, so one quantum carries one suspend
        //     and the context never sees a duplicate;
        //   - the time passed to suspend() stays the caller's raw frame, so the
        //     context's raw-time rejection is not tripped for a write inside the
        //     render.
        const suspendFrame = quantiseSuspendFrame(frame);

        const existing = callsByFrame.get(suspendFrame);
        if (existing) {
            // A suspend for this quantum is already registered — just append.
            existing.push(call);
            return;
        }

        const calls: (() => void)[] = [call];
        callsByFrame.set(suspendFrame, calls);

        // Exactly-once settlement. The frame's calls run once, on the first
        // settlement that reaches them — a resolved suspend, a rejected suspend
        // (the frame was already past when it was registered, so firing now is a
        // best-effort fallback rather than dropping the calls), or a synchronous
        // throw from `suspend()`. Nothing that settles afterwards re-runs them:
        // `resume()` used to ride the same promise chain, so a resume rejection
        // after a successful suspend arrived back here as a rejection, and a
        // queued callback that threw arrived the same way.
        let ran = false;

        function fire(): void {
            if (ran) {
                return;
            }
            ran = true;
            // Drop the frame before its calls run: one queued from inside a
            // callback is a new batch, not a late append to a settled one.
            callsByFrame.delete(suspendFrame);
            try {
                runCalls(calls);
            } catch {
                // A queued callback's exception is dropped here rather than left
                // to become an unhandled rejection on the settle chain; the frame
                // has already run and must not run again.
            } finally {
                // A throwing callback must not leave the render suspended forever.
                void ctx.resume().catch(() => undefined);
            }
        }

        try {
            // Raw frame, not the quantised key: the context rounds it up itself.
            void ctx.suspend(frame / sampleRate).then(
                () => {
                    fire();
                },
                () => {
                    // suspend() rejects (rather than throws) when the frame is
                    // already in the past by the time it is registered. Fire this
                    // frame's calls immediately as a best-effort fallback rather
                    // than dropping the notes or leaving an unhandled rejection.
                    fire();
                }
            );
        } catch {
            // Some implementations throw synchronously instead of rejecting.
            fire();
        }
    };
}

/** Invoke every queued callback for a frame, in registration order. */
function runCalls(calls: (() => void)[]): void {
    for (const queued of calls) {
        queued();
    }
}
