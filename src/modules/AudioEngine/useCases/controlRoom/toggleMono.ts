import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function toggleMono(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, monoActive: !state.monoActive });
}
