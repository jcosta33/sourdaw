import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function setTalkbackLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, talkbackLevel: levelDb });
}
