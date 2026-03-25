import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function toggleReference(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, referenceActive: !state.referenceActive });
}
