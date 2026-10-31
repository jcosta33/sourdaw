import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { stopRecording, takeOwnsRecordingRoot } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';
import { waitForOverdubLanding } from '#/modules/MIDI/useCases';

import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { captureManualRecordingEnd, type ManualRecordingEnd } from './captureManualRecordingEnd';
import { manualClosingBeat } from './manualClosingBeat';
import { recordingLifecycle } from './recordingLifecycle';

/** A failed Record start may close only its own capture; flush and clip closure can admit a successor reentrantly. */
async function closeActiveRecording(stillOwns?: () => boolean, gestureEnding?: ManualRecordingEnd): Promise<void> {
    if (stillOwns?.() === false) {
        return;
    }
    recordingLifecycle.cancelPendingRecordingStart();
    const ending = gestureEnding ?? captureManualRecordingEnd();
    recordingLifecycle.endRecording();
    const recordingFlush = stopAudioRecording();
    if (stillOwns?.() === false) {
        await recordingFlush;
        return;
    }
    // A manual ending belongs to its synchronous receipt, between ticks too.
    // The last published playhead can precede captured PCM; passing it as an
    // intended cap would discard the tail before a pending seam sounds.
    // Whether the receipt dates a rolling transport is read with the receipt:
    // Pause parks the transport before it stops the recorder, and its parked
    // position is the last tick's beat, not the gesture's.
    const closesTake = activeRecordingRef.current.length > 0 && takeOwnsRecordingRoot();
    const recordingCommit = stopRecording(manualClosingBeat(ending), ending, true);
    if (closesTake) {
        // Counted as a settled take commit, which a project replacement reads to
        // know that the project it is leaving gained a take. A stop the root
        // guard will refuse closes no take (#5517): counting it would owe the
        // next replacement a save for a take this project never gained.
        recordingLifecycle.trackTakeCommit(recordingCommit);
    }

    if (stillOwns?.() !== false) {
        const timerId = recordingLifecycle.countInTimerId;
        if (timerId !== null) {
            clearTimeout(timerId);
            recordingLifecycle.setCountInTimerId(null);
        }

        updateTransportState({ isRecording: false });
    }
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
 *
 * A gesture that parks the transport before it stops the recorder passes the
 * ending it read while the transport still rolled: once parked, the gesture
 * clock answers the stored position, which no longer pairs with the audio
 * clock read beside it.
 */
export async function stopActiveRecording(
    stillOwns?: () => boolean,
    gestureEnding?: ManualRecordingEnd
): Promise<void> {
    const closing = closeActiveRecording(stillOwns, gestureEnding);
    recordingLifecycle.trackClosing(closing);
    try {
        await closing;
    } finally {
        await recordingLifecycle.waitForClosing();
        await waitForOverdubLanding();
    }
}
