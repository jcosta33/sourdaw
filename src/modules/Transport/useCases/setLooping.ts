import { transportStore } from '../stores/transportStore';

export function disableLooping(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, isLooping: false });
}

export function enableLooping(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, isLooping: true });
}

export function toggleLooping(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }
    transportStore.set({ ...state, isLooping: !state.isLooping });
}
