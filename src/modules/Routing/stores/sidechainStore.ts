import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type SidechainRoute } from '../models/SidechainRoute';

const DOC_PREFIX_ROOT = 'root';

export type SidechainStoreState = {
    routes: SidechainRoute[];
};

export const defaultSidechainStoreState: SidechainStoreState = { routes: [] };

export const sidechainStore = createStore<SidechainStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes'),
    initialData: defaultSidechainStoreState,
});
