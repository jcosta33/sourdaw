import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function toggleReference(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, referenceActive: !state.referenceActive });
}
