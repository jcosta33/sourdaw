import { type PendingWorkletEvent } from './types';

/**
 * Register suspend points on the OfflineAudioContext for all collected
 * worklet note events. Must be called ONCE after ALL tracks are scheduled
 * and BEFORE startRendering().
 *
 * Events at the same quantized time (render quantum = 128 frames) are batched
 * into a single suspend() call to avoid InvalidStateError.
 */
export function schedulePendingSuspends(
    offlineCtx: OfflineAudioContext,
    events: PendingWorkletEvent[],
    durationSeconds: number
): void {
    if (events.length === 0) {
        return;
    }

    // Sort by time, then noteOff before noteOn at same time (release before re-trigger).
    events.sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));

    const quantumDuration = 128 / offlineCtx.sampleRate;
    const batchedByTime = new Map<number, PendingWorkletEvent[]>();

    for (const evt of events) {
        // Clamp to (0, duration) — can't suspend at 0 or beyond the render length.
        const clampedTime = Math.max(quantumDuration, Math.min(evt.time, durationSeconds - quantumDuration));
        const quantized = Math.floor(clampedTime / quantumDuration) * quantumDuration;
        const batch = batchedByTime.get(quantized);
        if (batch) {
            batch.push(evt);
        } else {
            batchedByTime.set(quantized, [evt]);
        }
    }

    for (const [suspendTime, batch] of batchedByTime) {
        offlineCtx.suspend(suspendTime).then(() => {
            for (const evt of batch) {
                if (evt.type === 'on') {
                    if (evt.isToaster) {
                        const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : evt.pitch % 16;
                        evt.instrumentControls.noteOn(pad, evt.velocity, evt.pitch);
                    } else {
                        evt.instrumentControls.noteOn(evt.pitch, evt.velocity);
                    }
                } else {
                    if (evt.isToaster) {
                        const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : evt.pitch % 16;
                        evt.instrumentControls.noteOff(pad);
                    } else {
                        evt.instrumentControls.noteOff(evt.pitch);
                    }
                }
            }
            offlineCtx.resume();
        });
    }
}
