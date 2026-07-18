import { controlRoomStore } from '../../stores/controlRoom';

export function setTalkbackLevel(levelDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, talkbackLevel: levelDb });
}
