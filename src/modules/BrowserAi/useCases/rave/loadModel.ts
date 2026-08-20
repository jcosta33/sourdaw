import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { raveStore, raveLogger } from '../../stores/rave';

/**
 * Activate a RAVE model.
 *
 * Only a model registered by `initRaveModels` — i.e. one whose weights are
 * actually present in OPFS — can be activated. Anything else **throws**: this
 * is the last gate in front of the `loadRaveModel` action, which the AI runtime
 * can issue without going through the command palette.
 *
 * It throws rather than returning quietly because a silent refusal is not a
 * refusal the user can see. `executeAppActionBatch` reports a throwing handler
 * as `failed`; a handler that returns cleanly is reported as `executed`, and
 * `notifyAiChange` then toasts the user's own prompt back as if it had been
 * carried out. Withholding the store write while announcing success is the
 * exact dishonesty this gate exists to stop.
 */
export function loadModel(modelId: string): void {
    if (!MODEL_RELEASE_ADMISSION.rave) {
        throw new Error('RAVE model artifacts are not admitted in this release');
    }
    const state = raveStore.value;
    if (!state) {
        throw new Error('RAVE store is not initialised');
    }
    const isPresent = state.models.some((model) => model.id === modelId);
    if (!isPresent) {
        raveLogger.warn(`RAVE model unavailable: ${modelId} — no model weights present`);
        throw new Error(`RAVE model unavailable: ${modelId} — no model weights are present`);
    }
    raveStore.set({
        ...state,
        models: state.models.map((message) => (message.id === modelId ? { ...message, loaded: true } : message)),
        activeModelId: modelId,
    });
    raveLogger.info(`RAVE model loaded: ${modelId}`);
}
