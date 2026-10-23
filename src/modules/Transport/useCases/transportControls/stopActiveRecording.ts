import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { captureRecordingEnd } from './captureRecordingEnd';
import { recordingLifecycle } from './recordingLifecycle';

async function closeActiveRecording(): Promise<void> {
    recordingLifecycle.cancelPendingRecordingStart();
    const ending = captureRecordingEnd();
    recordingLifecycle.endRecording();
    const recordingFlush = stopAudioRecording();
    // A manual ending belongs to its synchronous receipt, between ticks too.
    // The last published playhead can precede captured PCM; passing it as an
    // intended cap would discard the tail before a pending seam sounds.
    const rolling = getTransportState()?.isPlaying === true;
    const closesTake = activeRecordingRef.current.length > 0;
    const recordingCommit = stopRecording(
        rolling ? ending?.beatAtContextSeconds(ending.contextSeconds) : undefined,
        ending,
        true
    );
    if (closesTake) {
        // Counted as a settled take commit, which a project replacement reads to
        // know that the project it is leaving gained a take.
        recordingLifecycle.trackCommit(recordingCommit);
    }

    const timerId = recordingLifecycle.countInTimerId;
    if (timerId !== null) {
        clearTimeout(timerId);
        recordingLifecycle.setCountInTimerId(null);
    }

    updateTransportState({ isRecording: false });
    await recordingFlush;
    // The terminal that registers the audio commit runs inside the flush, so
    // this is where that promise becomes waitable.
    await recordingLifecycle.waitForCommits();
    await recordingCommit;
}

/**
 * Stop the recording the user asked to stop, and do not resolve before the
 * commits this gesture started have landed.
 *
 * Both arms commit from a terminal the audio flush runs around: the MIDI commit
 * is `stopRecording`'s promise, the audio commit is tracked on the recording
 * lifecycle by the capture terminal. The very next Undo acts on whatever heads
 * the history, so resolving on the flush alone would let it consume the previous
 * entry while this gesture's commit was still in flight — the late-arrival class
 * #4439 forbids. The transport state is written synchronously before either is
 * awaited, and the commit is main-thread work, so neither the audio thread nor
 * the scheduler is held behind it.
 *
 * The stop is registered as closing for as long as it runs, and it also waits
 * for every other stop still closing: a second stop finds the recorder already
 * stopped and its own flush resolves at once, yet the first stop's terminal may
 * not have registered its commit yet, so only the first stop can say when the
 * take has landed.
 */
export async function stopActiveRecording(): Promise<void> {
    const closing = closeActiveRecording();
    recordingLifecycle.trackClosing(closing);
    try {
        await closing;
    } finally {
        await recordingLifecycle.waitForClosing();
    }
}
