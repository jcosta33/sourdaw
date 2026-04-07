import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type TakeLane } from '#/modules/Arrangement/models/TakeLane';

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const takeLaneStore = createStore<TakeLaneStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'takeLanes'),
    initialData: { lanes: [] },
});
