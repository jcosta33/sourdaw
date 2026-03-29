import { transportStore } from '../stores/transportStore';

export function disableLooping(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, isLooping: false });
}
