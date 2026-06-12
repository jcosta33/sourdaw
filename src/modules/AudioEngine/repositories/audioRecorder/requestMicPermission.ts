import { audioRecordingStore } from '../../stores/audioRecordingStore';

/**
 * Pre-request microphone permission so the browser prompt fires on page load
 * rather than at first-record time. The stream is stopped immediately.
 */
export async function requestMicPermission(): Promise<boolean> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        for (const track of stream.getTracks()) {
            track.stop();
        }
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: true });
        return true;
    } catch {
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: false });
        return false;
    }
}
