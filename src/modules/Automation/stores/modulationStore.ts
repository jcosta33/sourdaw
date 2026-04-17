import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Modulator } from '../models/Modulator';

const DOC_PREFIX_ROOT = 'root';

export type ModulationStoreState = {
    modulators: Modulator[];
};

export const modulationStore = createStore<ModulationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'modulation'),
    initialData: {
        modulators: [],
    },
});

/** Ephemeral runtime values for modulators (0..1), updated at 30fps. Not persisted. */
export const modulationRuntimeStore = createStore<{ runtimeValues: Record<string, number> }>({
    initialData: {
        runtimeValues: {},
    },
});
