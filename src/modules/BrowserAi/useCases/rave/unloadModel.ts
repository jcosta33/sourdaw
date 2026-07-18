import { raveStore } from '../../stores/rave';

export function unloadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((message) => (message.id === modelId ? { ...message, loaded: false } : message)),
        activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
    });
}
