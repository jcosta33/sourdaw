import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export function setPostRoll(beats: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({ ...state, defaultPostRoll: beats });
}
