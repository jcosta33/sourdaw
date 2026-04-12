import { raveStore, FACTORY_MODELS } from '../../stores/rave';

export function registerFactoryModels(): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: FACTORY_MODELS.map((m) => ({ ...m, loaded: false })),
    });
}
