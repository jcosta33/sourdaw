import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export function setPreRoll(beats: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, defaultPreRoll: beats });
}
