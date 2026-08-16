import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';

import { recordingLifecycle } from './recordingLifecycle';

export function stopActiveRecording(): Promise<void> {
    recordingLifecycle.cancelPendingRecordingStart();
    const recordingFlush = stopAudioRecording();
    // Close the clips where the playhead actually is. Mid-playback the transport
    // store still holds the beat playback started at (it is written on discrete
    // events only), which would truncate the take back to its own start beat.
    const rolling = getTransportState()?.isPlaying === true;
    stopRecording(rolling ? playheadPositionRef.current : undefined);

    const timerId = recordingLifecycle.countInTimerId;
    if (timerId !== null) {
        clearTimeout(timerId);
        recordingLifecycle.setCountInTimerId(null);
    }

    updateTransportState({ isRecording: false });
    return recordingFlush;
}
