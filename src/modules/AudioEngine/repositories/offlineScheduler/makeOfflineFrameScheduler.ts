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

        function fireImmediately(): void {
            runCalls(calls);
            callsByFrame.delete(frame);
        }

        function onSuspend(): Promise<void> {
            runCalls(calls);
            return ctx.resume();
        }

        try {
            void ctx
                .suspend(quantTime)
                .then(onSuspend)
                // suspend() rejects (rather than throws) when the frame is already
                // in the past by the time it is registered. Fire this frame's
                // calls immediately as a best-effort fallback rather than dropping
                // the notes or leaving an unhandled rejection.
                .catch(fireImmediately);
        } catch {
            // Some implementations throw synchronously instead of rejecting.
            fireImmediately();
        }
    };
}

/** Invoke every queued callback for a frame, in registration order. */
function runCalls(calls: (() => void)[]): void {
    for (const queued of calls) {
        queued();
    }
}
