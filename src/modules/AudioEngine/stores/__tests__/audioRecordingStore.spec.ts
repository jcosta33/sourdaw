import { describe, it, expect, beforeEach } from 'vitest';

import { audioRecordingStore } from '../audioRecordingStore';

describe('audioRecordingStore', () => {
    beforeEach(() => {
        audioRecordingStore.set({ isRecording: false, micPermissionGranted: false });
    });

    it('should have initial state', () => {
        expect(audioRecordingStore.value?.isRecording).toBe(false);
        expect(audioRecordingStore.value?.micPermissionGranted).toBe(false);
    });

    it('should update state', () => {
        audioRecordingStore.update((state) => ({ ...state!, isRecording: true, micPermissionGranted: true }));
        expect(audioRecordingStore.value?.isRecording).toBe(true);
        expect(audioRecordingStore.value?.micPermissionGranted).toBe(true);
    });
});
