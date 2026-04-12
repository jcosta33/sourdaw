import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function togglePunchRecording(): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, enabled: !state.enabled });
}
