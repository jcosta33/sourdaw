import { startAudioRecording as startAudioRecordingRepo } from '../../repositories/audioRecorder/recording';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

export function startAudioRecording(
    trackId: string,
    onComplete: (buffer: AudioBuffer) => void,
    inputId?: string | null
): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    return startAudioRecordingRepo(trackId, onComplete, selectedInputId);
}
