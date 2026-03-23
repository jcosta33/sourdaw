import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function toggleMute(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, muted: !state.muted });
}
