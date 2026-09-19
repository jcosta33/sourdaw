/**
 * Repository: offline render frame scheduler.
 *
 * Irreducible reason for batching: registering `suspend(time)` for a frame that
 * already has one scheduled throws, so every call due on one quantised sample
 * frame must ride a single suspend.
 */

export type ScheduleCall = (time: number | undefined, call: () => void) => void;

/**
 * Offline scheduler: batch all note events sharing a sample frame behind a
 * single `ctx.suspend(time)` instead of registering O(N) suspend→resume
 * transitions (one per note). Two notes that land on the same frame previously
 * threw "cannot schedule a suspend at frame X" on the second `suspend()` call,
 * which was caught and fired the note immediately at the wrong time. Quantising
 * `time` to the context sample frame collapses near-duplicates so each distinct
 * frame gets exactly one suspend whose handler runs every queued call in order.
 */
export function makeOfflineFrameScheduler(ctx: OfflineAudioContext): ScheduleCall {
    const { sampleRate } = ctx;
    // Keyed by quantised sample frame. Each entry holds every call due at that
    // frame; the first call to a frame registers a single suspend for it.
    const callsByFrame = new Map<number, (() => void)[]>();

    return (time, call) => {
        if (time === undefined || time <= ctx.currentTime) {
            call();
            return;
        }

        // Quantise to the nearest sample frame so float drift between notes that
        // are meant to share a frame does not split into two suspends.
        const frame = Math.max(0, Math.round(time * sampleRate));
        const quantTime = frame / sampleRate;

        const existing = callsByFrame.get(frame);
        if (existing) {
            // A suspend for this frame is already registered — just append.
            existing.push(call);
            return;
        }

        const calls: (() => void)[] = [call];
        callsByFrame.set(frame, calls);

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
            callsByFrame.delete(frame);
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
            void ctx.suspend(quantTime).then(
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
