import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { recordingLifecycle } from './recordingLifecycle';

export function stopActiveRecording(): Promise<void> {
    recordingLifecycle.cancelPendingRecordingStart();
    const recordingFlush = stopAudioRecording();
    stopRecording();

    const timerId = recordingLifecycle.countInTimerId;
    if (timerId !== null) {
        clearTimeout(timerId);
        recordingLifecycle.setCountInTimerId(null);
    }

    updateTransportState({ isRecording: false });
    return recordingFlush;
}
