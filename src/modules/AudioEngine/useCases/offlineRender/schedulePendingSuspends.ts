import { resolveToasterPadIndex } from '#/utils/toasterNoteProjection';

import { comparePendingWorkletEvents } from './comparePendingWorkletEvents';
import { type PendingWorkletEvent } from './types';

/**
 * Pre-queue all collected worklet note events to their respective DSP processors.
 * Must be called ONCE after ALL tracks are scheduled and BEFORE startRendering().
 *
 * This uses the sample-accurate `sampleFrame` parameter instead of main-thread
 * OfflineAudioContext.suspend() polling, preventing timing drift.
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
    events.sort(comparePendingWorkletEvents);

    for (const evt of events) {
        if (evt.time >= durationSeconds) {
            continue;
        }

        const sampleFrame = Math.max(0, Math.floor(evt.time * offlineCtx.sampleRate));

        if (evt.type === 'on') {
            if (evt.isToaster) {
                const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : resolveToasterPadIndex(evt.pitch);
                if (pad === null) {
                    continue;
                }
                evt.instrumentControls.noteOn(pad, evt.velocity, evt.pitch, sampleFrame);
            } else {
                evt.instrumentControls.noteOn(evt.pitch, evt.velocity, undefined, sampleFrame);
            }
        } else {
            if (evt.isToaster) {
                const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : resolveToasterPadIndex(evt.pitch);
                if (pad === null) {
                    continue;
                }
                evt.instrumentControls.noteOff(pad, sampleFrame);
            } else {
                evt.instrumentControls.noteOff(evt.pitch, sampleFrame);
            }
        }
    }
}
