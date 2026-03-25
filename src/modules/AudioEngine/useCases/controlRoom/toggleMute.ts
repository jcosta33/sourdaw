import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function toggleMute(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, muted: !state.muted });
}
