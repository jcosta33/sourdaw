import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function toggleTalkback(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, talkbackActive: !state.talkbackActive });
}
