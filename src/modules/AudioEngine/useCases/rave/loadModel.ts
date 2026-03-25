import { raveStore, raveLogger } from '#/modules/AudioEngine/stores/rave';

export function loadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((m) => (m.id === modelId ? { ...m, loaded: true } : m)),
        activeModelId: modelId,
    });
    raveLogger.info(`RAVE model loaded: ${modelId}`);
}
