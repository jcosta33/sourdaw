/**
 * Hook to subscribe to the actual hardware audio recording state.
 */
import { useStore } from '#/infra/store/useStore';
import { audioRecordingStore, type AudioRecordingState } from '#/modules/AudioEngine';

const defaultState: AudioRecordingState = { isRecording: false, micPermissionGranted: false };

export function useAudioRecordingState(): AudioRecordingState {
    return useStore(audioRecordingStore, defaultState);
}
