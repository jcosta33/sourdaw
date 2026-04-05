import { stopAudioRecording as stopAudioRecordingRepo } from '../../repositories/audioRecorder/recording';

export function stopAudioRecording(): void {
    stopAudioRecordingRepo();
}
