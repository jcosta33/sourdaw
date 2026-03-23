import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function setDimLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, dimLevel: levelDb });
}
