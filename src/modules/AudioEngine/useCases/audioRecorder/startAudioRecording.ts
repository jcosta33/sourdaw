import { startAudioRecording as startAudioRecordingRepo } from '../../repositories/audioRecorder/recording';

export function startAudioRecording(
    trackId: string,
    onComplete: (buffer: AudioBuffer) => void,
    inputId?: string | null
): Promise<boolean> {
    return startAudioRecordingRepo(trackId, onComplete, inputId);
}
