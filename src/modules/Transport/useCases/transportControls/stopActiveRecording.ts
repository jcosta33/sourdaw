import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * Stop the recording the user asked to stop, and do not resolve before the MIDI
 * commit `stopRecording` triggers has landed.
 *
 * A MIDI recording commits inside `stopRecording`, and the very next Undo acts
 * on whatever heads the history. Returning on the audio flush alone would let a
 * caller observe — and undo — the previous entry while this gesture's commit
 * was still in flight, which is the late-arrival class #4439 forbids. So both
 * promises are awaited here. The audio path's own ordering is untouched: its
 * entry still arrives with the capture terminal the flush resolves around, and
 * the transport state is written synchronously before either is awaited, so no
 * scheduler or audio-thread work is held behind the commit.
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
    await Promise.all([recordingFlush, recordingCommit]);
}
