import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function toggleMono(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, monoActive: !state.monoActive });
}
