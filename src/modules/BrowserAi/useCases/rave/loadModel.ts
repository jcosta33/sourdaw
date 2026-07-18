import { raveStore, raveLogger } from '../../stores/rave';

export function loadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((message) => (message.id === modelId ? { ...message, loaded: true } : message)),
        activeModelId: modelId,
    });
    raveLogger.info(`RAVE model loaded: ${modelId}`);
}
