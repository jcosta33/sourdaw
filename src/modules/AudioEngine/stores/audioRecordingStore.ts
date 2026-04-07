import { createStore } from '#/infra/store/createStore';

export type AudioRecordingState = {
    isRecording: boolean;
    micPermissionGranted: boolean;
};

export const audioRecordingStore = createStore<AudioRecordingState>({
    initialData: { isRecording: false, micPermissionGranted: false },
});
