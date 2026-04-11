/**
 * Hook to subscribe to the actual hardware audio recording state.
 */
import { useStore } from '#/infra/store/useStore';
import { audioRecordingStore } from '#/modules/AudioEngine/stores';

type AudioRecordingViewState = {
    isRecording: boolean;
    micPermissionGranted: boolean;
};

const defaultState: AudioRecordingViewState = { isRecording: false, micPermissionGranted: false };

export function useAudioRecordingState(): AudioRecordingViewState {
    return useStore(audioRecordingStore, defaultState);
}
