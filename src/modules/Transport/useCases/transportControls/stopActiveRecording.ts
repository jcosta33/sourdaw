import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';

import { recordingLifecycle } from './recordingLifecycle';

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
 */
export async function stopActiveRecording(): Promise<void> {
    recordingLifecycle.cancelPendingRecordingStart();
    const recordingFlush = stopAudioRecording();
    // Close the clips where the playhead actually is. Mid-playback the transport
    // store still holds the beat playback started at (it is written on discrete
    // events only), which would truncate the take back to its own start beat.
    const rolling = getTransportState()?.isPlaying === true;
    const recordingCommit = stopRecording(rolling ? playheadPositionRef.current : undefined);

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
