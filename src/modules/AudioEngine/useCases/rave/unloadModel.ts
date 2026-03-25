import { raveStore } from '#/modules/AudioEngine/stores/rave';

export function unloadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((m) => (m.id === modelId ? { ...m, loaded: false } : m)),
        activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
    });
}
