import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Modulator } from '../models/Modulator';

const DOC_PREFIX_ROOT = 'root';

export type ModulationStoreState = {
    modulators: Modulator[];
    /** Real-time values for each modulator (0..1), updated at 30fps.
     *  Not persisted in CRDT. */
    runtimeValues: Record<string, number>;
};

export const modulationStore = createStore<ModulationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'modulation'),
    initialData: {
        modulators: [],
        runtimeValues: {},
    },
});
