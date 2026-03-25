import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function setDimLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, dimLevel: levelDb });
}
