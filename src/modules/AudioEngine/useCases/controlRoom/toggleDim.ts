import { controlRoomStore } from '../../stores/controlRoom';

export function toggleDim(): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, dimActive: !state.dimActive });
}
