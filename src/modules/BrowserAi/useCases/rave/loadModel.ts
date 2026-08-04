import { raveStore, raveLogger } from '../../stores/rave';

/**
 * Activate a RAVE model.
 *
 * Only a model registered by `initRaveModels` — i.e. one whose weights are
 * actually present in OPFS — can be activated. Anything else is refused rather
 * than reported as loaded: this is the last gate in front of the
 * `loadRaveModel` action, which the AI runtime can issue without going through
 * the command palette.
 */
export function loadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    const isPresent = state.models.some((model) => model.id === modelId);
    if (!isPresent) {
        raveLogger.warn(`RAVE model unavailable: ${modelId} — no model weights present`);
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((message) => (message.id === modelId ? { ...message, loaded: true } : message)),
        activeModelId: modelId,
    });
    raveLogger.info(`RAVE model loaded: ${modelId}`);
}
