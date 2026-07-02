import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { updateTransportState } from '../../repositories/transport/updateTransportState';

import { countInTimerId, setCountInTimerId } from './recordingLifecycle';

export function stopActiveRecording(): void {
    stopAudioRecording();
    stopRecording();

    const timerId = countInTimerId;
    if (timerId !== null) {
        clearTimeout(timerId);
        setCountInTimerId(null);
    }

    updateTransportState({ isRecording: false });
}
