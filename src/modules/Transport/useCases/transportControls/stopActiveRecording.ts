import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { countInTimerId, setCountInTimerId } from './recordingLifecycle';

export function stopActiveRecording(): Promise<void> {
    const recordingFlush = stopAudioRecording();
    stopRecording();

    const timerId = countInTimerId;
    if (timerId !== null) {
        clearTimeout(timerId);
        setCountInTimerId(null);
    }

    updateTransportState({ isRecording: false });
    return recordingFlush;
}
