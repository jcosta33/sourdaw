import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type TakeLane } from '../models/TakeLane';

const DOC_PREFIX_ROOT = 'root';

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const takeLaneStore = createStore<TakeLaneStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'takeLanes'),
    initialData: { lanes: [] },
});
