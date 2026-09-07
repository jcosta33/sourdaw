import { startAudioRecording as startAudioRecordingRepo } from '../../repositories/audioRecorder/recording';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

export function startAudioRecording(
    trackId: string,
    onTerminal: Parameters<typeof startAudioRecordingRepo>[1],
    inputId?: string | null
): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    return startAudioRecordingRepo(trackId, onTerminal, selectedInputId);
}
