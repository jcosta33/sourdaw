import { raveStore, FACTORY_MODELS } from '../../stores/rave';

/**
 * Register the whole factory catalog, presence-blind.
 *
 * NOT the production path and deliberately unwired — `initRaveModels` is what
 * bootstrap calls, and it registers only the models whose weights are in OPFS.
 * Calling this instead would re-advertise RAVE models that do not exist.
 */
export function registerFactoryModels(): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: FACTORY_MODELS.map((message) => ({ ...message, loaded: false })),
    });
}
