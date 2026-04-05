/**
 * Hook to subscribe to the actual hardware audio recording state.
 */
import { useSyncExternalStore } from 'react';
import { audioRecordingStore, type AudioRecordingState } from '#/modules/AudioEngine/stores/audioRecordingStore';

const defaultState: AudioRecordingState = { isRecording: false, micPermissionGranted: false };

export function useAudioRecordingState(): AudioRecordingState {
    return useSyncExternalStore(
        (onChange) => audioRecordingStore.subscribe(() => onChange()),
        () => audioRecordingStore.value ?? defaultState,
        () => audioRecordingStore.value ?? defaultState
    );
}
