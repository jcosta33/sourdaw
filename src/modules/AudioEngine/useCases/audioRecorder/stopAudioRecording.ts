import { stopAudioRecording as stopAudioRecordingRepo } from '../../repositories/audioRecorder/stopAudioRecording';

export function stopAudioRecording(): void {
    stopAudioRecordingRepo();
}
